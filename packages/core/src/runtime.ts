import { createLogger, type PinoLogger } from './logger.js';
import { warmParser } from './safety/parse.js';
import { createPools, type Pools } from './postgres/pool.js';
import { introspect } from './postgres/introspect.js';
import { SchemaCache } from './schema/cache.js';
import { runDoctor } from './postgres/doctor.js';
import { Chain } from './audit/chain.js';
import { AuditPipeline, type AuditDestination } from './audit/pipeline.js';
import { FileDestination } from './audit/destinations/file.js';
import { StderrDestination } from './audit/destinations/stderr.js';
import { PostgresDestination } from './audit/destinations/postgres.js';
import { generateUlid, type ToolDeps } from './tools/context.js';
import { installStdoutGuard, uninstallStdoutGuard } from './server/stdout-guard.js';
import type { PgmoatConfigT } from './config/schema.js';
import type { DoctorFinding, Transport } from './types.js';

export interface RuntimeOptions {
  readonly allowUnsafeRole?: boolean;
  readonly transport?: Transport;
  readonly stdoutGuard?: boolean;
  readonly installSignalHandlers?: boolean;
}

export interface Runtime {
  readonly config: PgmoatConfigT;
  readonly logger: PinoLogger;
  readonly pools: Pools;
  readonly schemaCache: SchemaCache;
  readonly audit: AuditPipeline;
  readonly instanceId: string;
  readonly allowUnsafeRole: boolean;
  readonly doctorFindings: readonly DoctorFinding[];
  readonly toolDeps: ToolDeps;
  readonly currentUser: string;
  readonly inFlightCount: number;
  readonly isShuttingDown: boolean;
  incrementInFlight(): void;
  decrementInFlight(): void;
  shutdown(reason?: string): Promise<void>;
}

export class DoctorEnforceError extends Error {
  readonly findings: readonly DoctorFinding[];

  constructor(findings: readonly DoctorFinding[]) {
    const summary = findings
      .map((f) => `  - ${f.code}: ${f.message} (${f.subject})\n    Fix: ${f.fix}`)
      .join('\n');
    super(
      `Doctor preflight failed with ${findings.length} critical finding(s):\n${summary}\n` +
        `To allow unsafe roles, use --allow-unsafe-role or configure doctor.on_start: 'warn'.`,
    );
    this.name = 'DoctorEnforceError';
    this.findings = findings;
  }
}

/**
 * Creates the pgmoat runtime lifecycle:
 * 1. Logger (pino to fd 2)
 * 2. warmParser()
 * 3. Connection pools
 * 4. Initial catalog introspection
 * 5. Schema snapshot cache
 * 6. Doctor preflight check (on_start: enforce / warn / off)
 * 7. Audit pipeline (with hash chain and destination from config)
 * 8. Instance ID (ULID)
 * 9. Stdout guard (if stdio transport or explicitly requested)
 * 10. Graceful shutdown handler and signal listeners
 */
export async function createRuntime(
  config: PgmoatConfigT,
  options?: RuntimeOptions,
): Promise<Runtime> {
  // 1. Logger
  const logger = createLogger(config);

  // 2. Warm up parser
  await warmParser();

  // 3. Pools
  const pools = createPools(config, logger);

  // 4. Introspect
  let initialIntrospection;
  try {
    initialIntrospection = await introspect(pools, config.connection.schemas);
  } catch (err) {
    await pools.end();
    throw err;
  }

  // 5. Snapshot cache
  const schemaCache = new SchemaCache({
    config,
    introspect: () => introspect(pools, config.connection.schemas),
    initialIntrospection,
    onWarning: (msg, err) => logger.warn({ err }, msg),
  });

  // 6. Doctor
  const onStart = config.doctor?.on_start ?? 'enforce';
  let doctorFindings: DoctorFinding[] = [];
  const allowUnsafeRole = Boolean(options?.allowUnsafeRole);

  if (onStart !== 'off') {
    try {
      doctorFindings = await runDoctor(pools, config, initialIntrospection);
    } catch (err) {
      await pools.end();
      throw err;
    }

    const failFindings = doctorFindings.filter((f) => f.severity === 'fail');
    const warnFindings = doctorFindings.filter((f) => f.severity === 'warn');

    for (const w of warnFindings) {
      logger.warn({ finding: w }, `[doctor] ${w.code}: ${w.message} (${w.subject})`);
    }

    if (failFindings.length > 0) {
      if (onStart === 'enforce' && !allowUnsafeRole) {
        await pools.end();
        throw new DoctorEnforceError(failFindings);
      } else {
        for (const f of failFindings) {
          logger.warn(
            { finding: f },
            `[doctor:unsafe-override] ${f.code}: ${f.message} (${f.subject})`,
          );
        }
      }
    }
  }

  // 7. Audit pipeline
  const instanceId = generateUlid();
  const chain = new Chain(instanceId);

  const destinations: AuditDestination[] = [];
  if (config.audit.destination === 'stderr') {
    destinations.push(new StderrDestination());
  } else if (config.audit.destination === 'stdout') {
    destinations.push(new StderrDestination());
  } else if (config.audit.destination === 'postgres') {
    destinations.push(new PostgresDestination(config.audit.postgres));
  } else {
    // 'file'
    destinations.push(
      new FileDestination({
        ...(config.audit.path ? { dir: config.audit.path } : {}),
        rotation: config.audit.rotation,
      }),
    );
  }

  const audit = new AuditPipeline({
    chain,
    destinations,
    auditConfig: config.audit,
    logger: {
      error: (msg, ...args) => logger.error({ args }, msg),
      warn: (msg, ...args) => logger.warn({ args }, msg),
      info: (msg, ...args) => logger.info({ args }, msg),
    },
  });

  // 8. Stdout guard (if stdio)
  const isStdio = options?.transport === 'stdio' || options?.stdoutGuard;
  if (isStdio) {
    installStdoutGuard((msg) => logger.fatal({ msg }, msg));
  }

  // 9. Lifecycle state & shutdown tracking
  let inFlight = 0;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  const toolDeps: ToolDeps = {
    config,
    audit,
    instanceId,
    transport: options?.transport ?? (config.transport as Transport) ?? 'stdio',
    unsafeRoleOverride: allowUnsafeRole,
    schemaCache,
    pools,
  };

  let signalListenersInstalled = false;
  // Installing a handler replaces Node's default exit on these signals,
  // so exit once shutdown has flushed the audit log and closed the pools.
  const onSigint = () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  };
  const onSigterm = () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  };

  const removeSignalHandlers = () => {
    if (!signalListenersInstalled) return;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    signalListenersInstalled = false;
  };

  const installSignalHandlers = () => {
    if (signalListenersInstalled) return;
    signalListenersInstalled = true;
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  };

  if (options?.installSignalHandlers !== false) {
    installSignalHandlers();
  }

  const shutdown = async (reason = 'normal'): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      shuttingDown = true;
      logger.info({ reason }, `Initiating runtime shutdown (${reason})`);

      // Wait for in-flight requests up to 10s
      const deadline = Date.now() + 10_000;
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (inFlight > 0) {
        logger.warn({ inFlight }, 'Shutdown timeout reached while requests still in flight');
      }

      // Flush and shut down audit pipeline
      try {
        await audit.shutdown(5000);
      } catch (err) {
        logger.error({ err }, 'Error during audit pipeline shutdown');
      }

      // Close database pools
      try {
        await pools.end();
      } catch (err) {
        logger.error({ err }, 'Error during database pool shutdown');
      }

      removeSignalHandlers();

      if (isStdio) {
        uninstallStdoutGuard();
      }

      logger.info('Runtime shutdown complete');
    })();

    return shutdownPromise;
  };

  return {
    config,
    logger,
    pools,
    schemaCache,
    audit,
    instanceId,
    allowUnsafeRole,
    doctorFindings,
    toolDeps,
    currentUser: initialIntrospection.currentUser,
    get inFlightCount() {
      return inFlight;
    },
    get isShuttingDown() {
      return shuttingDown;
    },
    incrementInFlight() {
      if (shuttingDown) {
        throw new Error('Runtime is shutting down');
      }
      inFlight++;
    },
    decrementInFlight() {
      inFlight = Math.max(0, inFlight - 1);
    },
    shutdown,
  };
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createRuntime, DoctorEnforceError } from '../../src/runtime.js';
import { buildZeroConfig } from '../../src/config/defaults.js';
import { queryTool } from '../../src/tools/query.js';
import {
  installStdoutGuard,
  uninstallStdoutGuard,
  allowStdoutWrite,
  STDOUT_GUARD_ERROR_MESSAGE,
} from '../../src/server/stdout-guard.js';

describe('Runtime lifecycle & doctor integration (P7.2)', () => {
  let tmpAuditDir: string;

  beforeAll(async () => {
    await startPostgres();
    tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-runtime-test-'));
  }, 60000);

  afterAll(async () => {
    try {
      fs.rmSync(tmpAuditDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await stopPostgres();
  });

  it('starts cleanly with seed config and shuts down cleanly', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    config.doctor = { on_start: 'enforce' };
    config.audit = {
      destination: 'file',
      path: tmpAuditDir,
      rotation: 'daily',
      retain_days: 1,
      redact_fields: [],
    };

    const startTime = performance.now();
    const runtime = await createRuntime(config, {
      installSignalHandlers: false,
      stdoutGuard: false,
    });
    const startupDuration = performance.now() - startTime;
    process.stderr.write(`[Startup Timing Breakdown] Runtime startup took ${startupDuration.toFixed(2)}ms\n`);

    expect(runtime.instanceId).toHaveLength(26);
    expect(runtime.allowUnsafeRole).toBe(false);
    expect(runtime.isShuttingDown).toBe(false);

    // Schema cache should be loaded with introspected tables
    const snapshot = runtime.schemaCache.get();
    expect(snapshot.relations.length).toBeGreaterThan(0);
    expect(snapshot.relations.some((r) => r.name === 'orders')).toBe(true);

    // Track in-flight requests
    runtime.incrementInFlight();
    expect(runtime.inFlightCount).toBe(1);
    runtime.decrementInFlight();
    expect(runtime.inFlightCount).toBe(0);

    // Graceful shutdown
    await runtime.shutdown('test-completed');
    expect(runtime.isShuttingDown).toBe(true);
  });

  it('doctor enforce refuses startup with bypass role', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_bypass'));
    config.doctor = { on_start: 'enforce' };
    config.rls.protected_tables = ['orders'];
    config.audit = {
      destination: 'file',
      path: tmpAuditDir,
      rotation: 'daily',
      retain_days: 1,
      redact_fields: [],
    };

    let caughtErr: unknown = null;
    try {
      await createRuntime(config, {
        installSignalHandlers: false,
        stdoutGuard: false,
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(DoctorEnforceError);
    const doctorErr = caughtErr as DoctorEnforceError;
    expect(doctorErr.findings.some((f) => f.code === 'PGM-702')).toBe(true);
    expect(doctorErr.message).toContain('PGM-702');
  });

  it('allowUnsafeRole starts with bypass role and audit entries carry the override', async () => {
    const auditDir = fs.mkdtempSync(path.join(tmpAuditDir, 'override-'));
    const config = buildZeroConfig(connectionUrl('pgmoat_bypass'));
    config.doctor = { on_start: 'enforce' };
    config.rls.protected_tables = ['orders'];
    config.audit = {
      destination: 'file',
      path: auditDir,
      rotation: 'daily',
      retain_days: 1,
      redact_fields: [],
    };

    const runtime = await createRuntime(config, {
      allowUnsafeRole: true,
      installSignalHandlers: false,
      stdoutGuard: false,
    });

    expect(runtime.allowUnsafeRole).toBe(true);

    // Run query tool
    const res = await queryTool({ sql: 'SELECT 42 as num' }, {}, runtime.toolDeps);
    expect(res.isError).toBeUndefined();

    // Shutdown flushes audit pipeline
    await runtime.shutdown('test');

    // Read audit file from auditDir
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.ndjson'));
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(auditDir, files[0]!), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const entries = lines.map((l) => JSON.parse(l));
    const queryEntry = entries.find((e) => e.tool === 'query');
    expect(queryEntry).toBeDefined();
    expect(queryEntry.unsafe_role_override).toBe(true);
  });

  it('stdout guard catches a stray console.log in dev', () => {
    installStdoutGuard();
    try {
      expect(() => {
        console.log('stray output that should be blocked');
      }).toThrow(STDOUT_GUARD_ERROR_MESSAGE);

      let allowedRan = false;
      allowStdoutWrite(() => {
        allowedRan = true;
      });
      expect(allowedRan).toBe(true);
    } finally {
      uninstallStdoutGuard();
    }
  });
});

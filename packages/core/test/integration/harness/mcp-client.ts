import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SpawnedServerProcess {
  process: ChildProcess;
  rawStdoutLines: string[];
  stderrLines: string[];
  stop(): Promise<void>;
}

export function spawnServer(
  dbUrl: string,
  extraArgs: string[] = [],
  envOverrides: Record<string, string> = {},
): SpawnedServerProcess {
  const tsxPath = path.resolve(__dirname, '../../../../../node_modules/.bin/tsx');
  const scriptPath = path.resolve(__dirname, '../../../scripts/dev-stdio.ts');

  const proc = spawn(tsxPath, [scriptPath, ...extraArgs, dbUrl], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ...envOverrides,
    },
  });

  const rawStdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const stdoutRl = readline.createInterface({ input: proc.stdout! });
  stdoutRl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) rawStdoutLines.push(trimmed);
  });

  const stderrRl = readline.createInterface({ input: proc.stderr! });
  stderrRl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) stderrLines.push(trimmed);
  });

  return {
    process: proc,
    rawStdoutLines,
    stderrLines,
    async stop() {
      if (proc.exitCode !== null) return;
      proc.stdin?.end();
      const exitPromise = new Promise<void>((resolve) => {
        proc.once('exit', () => resolve());
      });
      const timeout = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }, 3000);
      await exitPromise;
      clearTimeout(timeout);
    },
  };
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id?: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class LegacyStdioClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (res: unknown) => void; reject: (err: unknown) => void }
  >();
  public rawStdoutLines: string[] = [];
  public stderrLines: string[] = [];

  constructor(proc: ChildProcess) {
    this.proc = proc;
    const stdoutRl = readline.createInterface({ input: proc.stdout! });
    stdoutRl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.rawStdoutLines.push(trimmed);
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(msg.error);
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // rawStdoutLines records all lines for stdout cleanliness checking
      }
    });

    const stderrRl = readline.createInterface({ input: proc.stderr! });
    stderrRl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) this.stderrLines.push(trimmed);
    });
  }

  send<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const payload =
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }) + '\n';

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (res: unknown) => void, reject });
      this.proc.stdin!.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    const payload =
      JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
      }) + '\n';
    this.proc.stdin!.write(payload);
  }

  async initialize(protocolVersion = '2024-11-05'): Promise<unknown> {
    const res = await this.send('initialize', {
      protocolVersion,
      clientInfo: { name: 'legacy-client', version: '1.0.0' },
      capabilities: {},
    });
    this.notify('notifications/initialized');
    return res;
  }
}

export function createModernClient(
  dbUrl: string,
  extraArgs: string[] = [],
  envOverrides: Record<string, string> = {},
): { client: Client; transport: StdioClientTransport } {
  const tsxPath = path.resolve(__dirname, '../../../../../node_modules/.bin/tsx');
  const scriptPath = path.resolve(__dirname, '../../../scripts/dev-stdio.ts');

  const transport = new StdioClientTransport({
    command: tsxPath,
    args: [scriptPath, ...extraArgs, dbUrl],
    stderr: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ...envOverrides,
    },
  });

  const client = new Client(
    { name: 'pgmoat-test-modern-client', version: '1.0.0' },
    { capabilities: {} },
  );

  return { client, transport };
}

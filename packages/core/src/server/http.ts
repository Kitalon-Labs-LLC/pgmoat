import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  validateHostHeader,
  validateOriginHeader,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
} from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer } from './create.js';
import { authenticate, emitAuthFailureAudit } from './auth.js';
import { buildProtectedResourceMetadata } from './prm.js';
import { principalStorage } from '../tools/context.js';
import type { Runtime } from '../runtime.js';

export interface HttpServerHandle {
  close(): Promise<void>;
  readonly port: number;
  readonly host: string;
}

export interface StartHttpOptions {
  readonly host?: string;
  readonly port?: number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Validates Host and Origin headers according to DNS rebinding rules and config.
 * Rejections respond with 403 JSON-RPC error containing PGM-603.
 */
function validateHostAndOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  isLoopback: boolean,
  allowedHosts: string[],
  allowedOrigins: string[],
): boolean {
  const hostnames = isLoopback ? localhostAllowedHostnames() : allowedHosts;
  const hostResult = validateHostHeader(req.headers.host, hostnames);
  if (!hostResult.ok) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `${hostResult.message} (PGM-603)`,
          data: { code: 'PGM-603' },
        },
        id: null,
      }),
    );
    return false;
  }

  const origins = isLoopback ? localhostAllowedOrigins() : allowedOrigins;
  const originResult = validateOriginHeader(req.headers.origin, origins);
  if (!originResult.ok) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `${originResult.message} (PGM-603)`,
          data: { code: 'PGM-603' },
        },
        id: null,
      }),
    );
    return false;
  }

  return true;
}

/**
 * Reads request body up to maxBytes.
 * Returns { ok: true, body } or { ok: false, status, message }
 */
async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; status: number; message: string }
> {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (!Number.isNaN(len) && len > maxBytes) {
      return {
        ok: false,
        status: 413,
        message: `Request body exceeds maximum size of ${maxBytes} bytes`,
      };
    }
  }

  let bytesRead = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    bytesRead += buf.length;
    if (bytesRead > maxBytes) {
      return {
        ok: false,
        status: 413,
        message: `Request body exceeds maximum size of ${maxBytes} bytes`,
      };
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) {
    return { ok: true, body: undefined };
  }

  try {
    const parsed = JSON.parse(raw);
    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      status: 400,
      message: 'Parse error: invalid JSON body',
    };
  }
}

/**
 * Checks readiness by attempting to acquire a reader pool connection with 1 s timeout.
 */
async function checkReadiness(runtime: Runtime): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Pool acquire timeout')), 1000);
  });

  try {
    const client = await Promise.race([
      runtime.pools.query.connect(),
      timeoutPromise,
    ]);
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Starts the stateless Streamable HTTP server for pgmoat.
 * Spec reference: spec/03 section 10.3, spec/02 F15, spec/05 section 3.1
 */
export async function startHttp(
  runtime: Runtime,
  options?: StartHttpOptions,
): Promise<HttpServerHandle> {
  const host = options?.host ?? runtime.config.http.host;
  const port = options?.port ?? runtime.config.http.port;
  const mcpPath = runtime.config.http.path;
  const maxBytes = runtime.config.http.max_body_bytes;
  const isLoopback = LOOPBACK_HOSTS.has(host.toLowerCase());
  const allowedHosts = runtime.config.http.allowed_hosts;
  const allowedOrigins = runtime.config.http.allowed_origins;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      // 1. Health endpoint
      if (pathname === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      // 2. Readiness endpoint
      if (pathname === '/readyz' && req.method === 'GET') {
        const isReady = await checkReadiness(runtime);
        if (isReady) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('ok');
        } else {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('service unavailable');
        }
        return;
      }

      // 3. DNS rebinding & Origin guards for all other endpoints
      if (!validateHostAndOrigin(req, res, isLoopback, allowedHosts, allowedOrigins)) {
        return;
      }

      // 4. Protected Resource Metadata endpoint (OAuth)
      if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
        if (runtime.config.auth && runtime.config.auth.mode === 'oauth') {
          const publicUrl = runtime.config.http.public_url ?? `http://${host}:${port}`;
          const prm = buildProtectedResourceMetadata(
            publicUrl,
            runtime.config.auth.issuer ?? publicUrl,
            runtime.config.auth.required_scopes,
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(prm, null, 2));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      // 5. MCP endpoint
      if (pathname === mcpPath) {
        // Authenticate request
        const authResult = await authenticate(req, runtime.config);
        if (!authResult.ok) {
          await emitAuthFailureAudit(runtime, authResult, req);
          res.writeHead(authResult.status, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': authResult.wwwAuthenticate,
          });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: authResult.message,
                data: { code: authResult.code },
              },
              id: null,
            }),
          );
          return;
        }

        let parsedBody: unknown = undefined;

        if (req.method === 'POST') {
          const bodyResult = await readJsonBody(req, maxBytes);
          if (!bodyResult.ok) {
            res.writeHead(bodyResult.status, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: bodyResult.status === 413 ? -32000 : -32700,
                  message: bodyResult.message,
                },
                id: null,
              }),
            );
            return;
          }
          parsedBody = bodyResult.body;
        }

        // Run handling within the authenticated principal context
        return await principalStorage.run(authResult.principal, async () => {
          // Stateless execution: new McpServer and transport per request
          runtime.incrementInFlight();

          const mcpServer = createServer(runtime.toolDeps);
          const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

          let cleanedUp = false;
          const cleanup = () => {
            if (!cleanedUp) {
              cleanedUp = true;
              runtime.decrementInFlight();
              void transport.close().catch(() => {});
              void mcpServer.close().catch(() => {});
            }
          };

          res.on('finish', cleanup);
          res.on('close', cleanup);

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        });
      }

      // Everything else: 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } catch (err) {
      runtime.logger.error({ err }, 'Streamable HTTP request processing error');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          }),
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: actualPort,
    host,
    close: async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

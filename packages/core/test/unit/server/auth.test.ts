import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http, { type IncomingMessage } from 'node:http';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type KeyLike,
  type JWK,
} from 'jose';
import {
  authenticate,
  extractBearerToken,
  extractScopes,
  emitAuthFailureAudit,
} from '../../../src/server/auth.js';
import { buildProtectedResourceMetadata, getPrmUrl } from '../../../src/server/prm.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';
import type { Runtime } from '../../../src/runtime.js';

describe('OAuth Resource Server (P9.2 - spec/03 section 10.4, RFC 9728)', () => {
  let jwksServer: http.Server;
  let jwksPort: number;
  let keyPair: { publicKey: KeyLike; privateKey: KeyLike };
  let publicJwk: JWK;
  const keyId = 'test-key-id-1';
  const issuer = 'https://auth.example.com';
  const audience = 'https://mcp.example.com';
  let config: PgmoatConfigT;

  beforeAll(async () => {
    // Generate test RSA key pair
    keyPair = await generateKeyPair('RS256', { extractable: true });
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    // Start local JWKS server
    jwksServer = http.createServer((req, res) => {
      if (req.url === '/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      jwksServer.listen(0, '127.0.0.1', () => {
        const addr = jwksServer.address();
        jwksPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });

    config = {
      version: 1,
      server: { name: 'test-server', description: '' },
      transport: 'http',
      http: {
        host: '127.0.0.1',
        port: 8787,
        path: '/mcp',
        public_url: audience,
        allowed_hosts: ['127.0.0.1'],
        allowed_origins: [],
        max_body_bytes: 1048576,
      },
      auth: {
        mode: 'oauth',
        issuer,
        audience,
        jwks_url: `http://127.0.0.1:${jwksPort}/jwks.json`,
        algorithms: ['RS256'],
        required_scopes: ['pgmoat:read'],
        clock_tolerance_s: 30,
      },
      connection: { url: 'postgres://localhost/test', schemas: ['public'] },
      mode: 'read-only',
      budgets: { max_rows: 200, max_query_ms: 5000, max_payload_bytes: 65536 },
      rls: { session_variables: {}, required: false },
      policy: {},
      tables: {},
      audit: { destination: 'file' },
      doctor: { on_start: 'warn' },
      logging: { level: 'info', format: 'ndjson' },
      telemetry: { enabled: false },
    } as unknown as PgmoatConfigT;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      jwksServer.close(() => resolve());
    });
  });

  function makeMockRequest(headers: Record<string, string>, url = '/mcp'): IncomingMessage {
    return {
      headers: Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      url,
      method: 'POST',
    } as unknown as IncomingMessage;
  }

  async function mintToken(
    claims: Record<string, unknown> = {},
    options: {
      iss?: string;
      aud?: string;
      exp?: string | number;
      nbf?: string | number;
      kid?: string;
      alg?: string;
    } = {},
  ): Promise<string> {
    const jwt = new SignJWT({
      sub: 'usr_12345',
      scope: 'pgmoat:read',
      ...claims,
    });

    const headerAlg = options.alg ?? 'RS256';
    jwt.setProtectedHeader({
      alg: headerAlg,
      kid: options.kid ?? keyId,
    });

    jwt.setIssuer(options.iss ?? issuer);
    jwt.setAudience(options.aud ?? audience);
    if (options.exp !== undefined) {
      jwt.setExpirationTime(options.exp);
    } else {
      jwt.setExpirationTime('1h');
    }
    if (options.nbf !== undefined) {
      jwt.setNotBefore(options.nbf);
    }

    return jwt.sign(keyPair.privateKey);
  }

  it('valid token: succeeds and returns principal with scopes and claims', async () => {
    const token = await mintToken({ email: 'alice@example.com' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.kind).toBe('token');
      expect(result.principal.sub).toBe('usr_12345');
      expect(result.principal.scopes.has('pgmoat:read')).toBe(true);
      expect(result.principal.claims['email']).toBe('alice@example.com');
    }
  });

  it('header case-insensitivity: accepts authorization in lowercase and mixed case', async () => {
    const token = await mintToken();
    const req = makeMockRequest({ authorization: `bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.sub).toBe('usr_12345');
    }
  });

  it('scp array form: correctly parses scopes from scp array claim', async () => {
    const token = await mintToken({ scope: undefined, scp: ['user', 'pgmoat:read'] });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.scopes.has('user')).toBe(true);
      expect(result.principal.scopes.has('pgmoat:read')).toBe(true);
    }
  });

  it('missing Authorization header: returns 401 with PGM-601 and PRM in WWW-Authenticate', async () => {
    const req = makeMockRequest({});
    const result = await authenticate(req, config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
      expect(result.wwwAuthenticate).toContain('Bearer resource_metadata=');
      expect(result.wwwAuthenticate).toContain(getPrmUrl(audience));
      expect(result.wwwAuthenticate).toContain('scope="pgmoat:read"');
    }
  });

  it('query string token is ignored: returns 401', async () => {
    const token = await mintToken();
    const req = makeMockRequest({}, `/mcp?token=${token}&access_token=${token}`);

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
    }
  });

  it('wrong audience: returns 401 with PGM-601', async () => {
    const token = await mintToken({}, { aud: 'https://different.service.com' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
      expect(result.message).toContain('aud');
    }
  });

  it('wrong issuer: returns 401 with PGM-601', async () => {
    const token = await mintToken({}, { iss: 'https://rogue-idp.example.com' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
      expect(result.message).toContain('iss');
    }
  });

  it('expired token: returns 401 with PGM-601', async () => {
    const token = await mintToken({}, { exp: '-1h' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
      expect(result.message).toContain('expired');
    }
  });

  it('not-yet-valid token (nbf in future): returns 401 with PGM-601', async () => {
    const token = await mintToken({}, { nbf: '2h' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
      expect(result.message).toContain('nbf');
    }
  });

  it('unknown kid: returns 401 with PGM-601', async () => {
    const token = await mintToken({}, { kid: 'non-existent-kid' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
    }
  });

  it('alg none: rejected with 401', async () => {
    // Unsecured JWT (alg: none)
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: audience,
        sub: 'evil',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.`;

    const req = makeMockRequest({ Authorization: `Bearer ${token}` });
    const result = await authenticate(req, config);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('PGM-601');
    }
  });

  it('missing scope: returns 403 with PGM-602 and insufficient_scope in WWW-Authenticate', async () => {
    const token = await mintToken({ scope: 'other:scope admin' });
    const req = makeMockRequest({ Authorization: `Bearer ${token}` });

    const result = await authenticate(req, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('PGM-602');
      expect(result.wwwAuthenticate).toContain('error="insufficient_scope"');
      expect(result.wwwAuthenticate).toContain('resource_metadata=');
    }
  });

  it('buildProtectedResourceMetadata returns valid RFC 9728 document', () => {
    const prm = buildProtectedResourceMetadata(
      'https://mcp.example.com',
      'https://auth.example.com',
      ['pgmoat:read'],
    );
    expect(prm.resource).toBe('https://mcp.example.com');
    expect(prm.authorization_servers).toEqual(['https://auth.example.com']);
    expect(prm.scopes_supported).toEqual(['pgmoat:read']);
    expect(prm.bearer_methods_supported).toEqual(['header']);
  });

  it('emitAuthFailureAudit records audit entry with tool auth and status refused', async () => {
    const emitted: unknown[] = [];
    const mockRuntime = {
      instanceId: '01JAB000000000000000000000',
      allowUnsafeRole: false,
      config,
      audit: {
        emit: (entry: unknown) => {
          emitted.push(entry);
        },
      },
      logger: {
        error: () => {},
      },
    } as unknown as Runtime;

    const failure = {
      ok: false as const,
      status: 401 as const,
      code: 'PGM-601' as const,
      message: 'Token expired',
      wwwAuthenticate: 'Bearer ...',
    };

    const req = makeMockRequest({ Authorization: 'Bearer invalid-token' });
    await emitAuthFailureAudit(mockRuntime, failure, req);

    expect(emitted.length).toBe(1);
    const entry = emitted[0] as Record<string, unknown>;
    expect(entry['tool']).toBe('auth');
    expect(entry['status']).toBe('refused');
    expect(entry['error_code']).toBe('PGM-601');
    expect(entry['principal']).toBe('anonymous');
    expect(entry['transport']).toBe('http');
  });

  it('extractBearerToken returns token or null', () => {
    const valid = makeMockRequest({ authorization: 'Bearer abc.123.xyz' });
    expect(extractBearerToken(valid)).toBe('abc.123.xyz');

    const empty = makeMockRequest({ authorization: 'Bearer ' });
    expect(extractBearerToken(empty)).toBeNull();

    const notBearer = makeMockRequest({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(extractBearerToken(notBearer)).toBeNull();

    const missing = makeMockRequest({});
    expect(extractBearerToken(missing)).toBeNull();
  });

  it('extractScopes parses space-delimited string and scp array/string', () => {
    const fromScope = extractScopes({ scope: 'read write admin' });
    expect(fromScope).toEqual(new Set(['read', 'write', 'admin']));

    const fromScpArray = extractScopes({ scp: ['read', 'admin'] });
    expect(fromScpArray).toEqual(new Set(['read', 'admin']));

    const fromScpString = extractScopes({ scp: 'read admin' });
    expect(fromScpString).toEqual(new Set(['read', 'admin']));
  });
});

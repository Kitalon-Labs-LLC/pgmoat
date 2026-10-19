#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';

// Generate in-memory RSA keypair for testing
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-key-1';
jwk.use = 'sig';
jwk.alg = 'RS256';

export function createJwt(payload) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: 'http://127.0.0.1:9090',
    iat: now,
    exp: now + 3600,
    ...payload,
  };

  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const data = `${encHeader}.${encPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  const signature = signer.sign(privateKey, 'base64url');

  return `${data}.${signature}`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/jwks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  } else if (req.url?.startsWith('/token')) {
    const url = new URL(req.url, 'http://127.0.0.1:9090');
    const tenantId = url.searchParams.get('tenant') || 'tenant_alpha';
    const token = createJwt({
      sub: 'agent_user_1',
      tenant_id: tenantId,
      scope: 'pgmoat:read',
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: token, token_type: 'Bearer' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(9090, '127.0.0.1', () => {
  console.log('Mock OIDC Identity Provider listening on http://127.0.0.1:9090');
});


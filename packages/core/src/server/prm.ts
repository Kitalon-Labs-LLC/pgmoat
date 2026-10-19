/**
 * Protected Resource Metadata (PRM) per RFC 9728 and MCP Authorization spec (2026-07-28).
 */

export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly bearer_methods_supported: readonly string[];
}

/**
 * Builds the Protected Resource Metadata document.
 */
export function buildProtectedResourceMetadata(
  publicUrl: string,
  issuer: string,
  scopesSupported: readonly string[],
): ProtectedResourceMetadata {
  return {
    resource: publicUrl,
    authorization_servers: [issuer],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ['header'],
  };
}

/**
 * Constructs the canonical PRM URL for WWW-Authenticate headers.
 */
export function getPrmUrl(publicUrl: string): string {
  return new URL('/.well-known/oauth-protected-resource', publicUrl).toString();
}

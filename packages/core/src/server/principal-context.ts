import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from '../types.js';

/**
 * AsyncLocalStorage storage for the authenticated principal during an HTTP request.
 * Propagates through all async call stacks, tool handlers, and audit logging.
 */
export const principalStorage = new AsyncLocalStorage<Principal>();

/**
 * Runs a callback within the context of the given Principal.
 */
export function withPrincipal<T>(principal: Principal, fn: () => T): T {
  return principalStorage.run(principal, fn);
}

/**
 * Gets the current request principal, or undefined if none is active.
 */
export function currentPrincipal(): Principal | undefined {
  return principalStorage.getStore();
}


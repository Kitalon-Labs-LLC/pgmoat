import type { SchemaSnapshot } from '../types.js';
import type { IntrospectionResult } from '../postgres/introspect.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { buildSnapshot } from './snapshot.js';

export interface SchemaCacheOptions {
  readonly config: PgmoatConfigT;
  readonly introspect: () => Promise<IntrospectionResult>;
  readonly ttlMs?: number;
  readonly clock?: () => number;
  readonly onWarning?: (message: string, error?: unknown) => void;
  readonly initialSnapshot?: SchemaSnapshot;
  readonly initialIntrospection?: IntrospectionResult;
}

/**
 * TTL cache for SchemaSnapshot with single-flight refresh,
 * stale-while-revalidate semantics, failure tolerance, and
 * in-memory annotation updates for file watching.
 */
export class SchemaCache {
  private config: PgmoatConfigT;
  private readonly introspectFn: () => Promise<IntrospectionResult>;
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly onWarning: (message: string, error?: unknown) => void;

  private currentSnapshot: SchemaSnapshot | null = null;
  private lastIntrospection: IntrospectionResult | null = null;
  private lastRefreshedAt: number = 0;
  private inFlightRefresh: Promise<SchemaSnapshot> | null = null;

  constructor(options: SchemaCacheOptions) {
    this.config = options.config;
    this.introspectFn = options.introspect;
    this.clock = options.clock ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? (options.config.schema?.cache_ttl_s ?? 60) * 1000;
    this.onWarning =
      options.onWarning ??
      ((msg: string) => {
        process.stderr.write(`[pgmoat:schema-cache] ${msg}\n`);
      });

    if (options.initialIntrospection) {
      this.lastIntrospection = options.initialIntrospection;
      this.currentSnapshot = buildSnapshot(
        options.initialIntrospection,
        this.config,
        new Date(this.clock()),
      );
      this.lastRefreshedAt = this.clock();
    } else if (options.initialSnapshot) {
      this.currentSnapshot = options.initialSnapshot;
      this.lastRefreshedAt = this.clock();
    }
  }

  /**
   * Returns the current snapshot immediately.
   * If older than TTL, triggers a single-flight background refresh (stale-while-revalidate).
   */
  get(): SchemaSnapshot {
    if (!this.currentSnapshot) {
      throw new Error(
        'SchemaCache has no snapshot available. Provide initialIntrospection or call refresh() first.',
      );
    }

    const now = this.clock();
    if (now - this.lastRefreshedAt >= this.ttlMs && !this.inFlightRefresh) {
      this.triggerBackgroundRefresh();
    }

    return this.currentSnapshot;
  }

  /**
   * Async variant: returns current snapshot immediately if warm (and triggers background refresh if expired);
   * or performs initial refresh if cold.
   */
  async getAsync(): Promise<SchemaSnapshot> {
    if (!this.currentSnapshot) {
      return this.refresh();
    }
    return this.get();
  }

  /**
   * Explicitly triggers or joins a refresh, awaiting the fresh snapshot.
   */
  async refresh(): Promise<SchemaSnapshot> {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    const promise = this.executeRefresh().finally(() => {
      if (this.inFlightRefresh === promise) {
        this.inFlightRefresh = null;
      }
    });

    this.inFlightRefresh = promise;
    return promise;
  }

  /**
   * Rebuilds the snapshot from the last raw introspection without hitting the database (for --watch).
   */
  applyAnnotations(newConfig: PgmoatConfigT): SchemaSnapshot {
    this.config = newConfig;
    if (!this.lastIntrospection) {
      throw new Error('Cannot apply annotations: no prior introspection result available.');
    }

    const updated = buildSnapshot(this.lastIntrospection, newConfig, new Date(this.clock()));
    this.currentSnapshot = updated;
    return updated;
  }

  /**
   * Returns the in-flight refresh promise if any, allowing deterministic testing of background tasks.
   */
  async waitForRefresh(): Promise<SchemaSnapshot | null> {
    if (this.inFlightRefresh) {
      try {
        return await this.inFlightRefresh;
      } catch {
        return this.currentSnapshot;
      }
    }
    return this.currentSnapshot;
  }

  get snapshot(): SchemaSnapshot | null {
    return this.currentSnapshot;
  }

  get lastIntrospectionResult(): IntrospectionResult | null {
    return this.lastIntrospection;
  }

  get isRefreshing(): boolean {
    return this.inFlightRefresh !== null;
  }

  private triggerBackgroundRefresh(): void {
    if (this.inFlightRefresh) {
      return;
    }

    const promise = this.executeRefresh()
      .catch((err) => {
        this.onWarning(
          `Background schema refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
        // Reset lastRefreshedAt to now so we do not spin every call; retries at next TTL
        this.lastRefreshedAt = this.clock();
        return this.currentSnapshot as SchemaSnapshot;
      })
      .finally(() => {
        if (this.inFlightRefresh === promise) {
          this.inFlightRefresh = null;
        }
      });

    this.inFlightRefresh = promise;
  }

  private async executeRefresh(): Promise<SchemaSnapshot> {
    const introspection = await this.introspectFn();
    this.lastIntrospection = introspection;
    const snapshot = buildSnapshot(introspection, this.config, new Date(this.clock()));
    this.currentSnapshot = snapshot;
    this.lastRefreshedAt = this.clock();
    return snapshot;
  }
}

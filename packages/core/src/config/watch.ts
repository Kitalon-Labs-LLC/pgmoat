import fs from 'node:fs';
import { refuse, type PgmoatError } from '../errors.js';
import { loadConfig } from './load.js';
import type { PgmoatConfigT } from './schema.js';

export type ConfigChangeHandler = (
  newConfig: PgmoatConfigT,
  warnings: PgmoatError[],
) => void;

export type ConfigErrorHandler = (error: PgmoatError) => void;

export function watchConfig(
  configPath: string,
  currentConfig: PgmoatConfigT,
  onChange: ConfigChangeHandler,
  onError?: ConfigErrorHandler,
): () => void {
  let activeConfig = currentConfig;
  let debounceTimer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  let isPolling = false;

  const handleFileChange = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      try {
        const loaded = loadConfig({ path: configPath });
        if (loaded.kind !== 'file') {
          return;
        }

        const newConfig = loaded.config;
        const warnings = [...loaded.warnings];

        // Check non-reloadable sections: connection, transport, http, auth, audit, rls.session_variables
        const nonReloadableChanged =
          JSON.stringify(activeConfig.connection) !==
            JSON.stringify(newConfig.connection) ||
          activeConfig.transport !== newConfig.transport ||
          JSON.stringify(activeConfig.http) !==
            JSON.stringify(newConfig.http) ||
          JSON.stringify(activeConfig.auth) !==
            JSON.stringify(newConfig.auth) ||
          JSON.stringify(activeConfig.audit) !==
            JSON.stringify(newConfig.audit) ||
          JSON.stringify(activeConfig.rls.session_variables) !==
            JSON.stringify(newConfig.rls.session_variables);

        if (nonReloadableChanged) {
          warnings.push(
            refuse(
              'PGM-109',
              'Restart required: changes to connection, transport, http, auth, audit, or rls.session_variables will not take effect until restart',
            ),
          );
        }

        // Apply reloadable sections only
        const appliedConfig: PgmoatConfigT = Object.freeze({
          ...activeConfig,
          tables: newConfig.tables,
          budgets: newConfig.budgets,
          policy: newConfig.policy,
          schema: newConfig.schema,
          logging: newConfig.logging,
          rls: Object.freeze({
            ...activeConfig.rls,
            protected_tables: newConfig.rls.protected_tables,
          }),
        });

        activeConfig = appliedConfig;
        onChange(appliedConfig, warnings);
      } catch (err) {
        if (onError && err instanceof Error) {
          onError(err as PgmoatError);
        }
      }
    }, 200);
  };

  try {
    watcher = fs.watch(configPath, () => {
      handleFileChange();
    });
  } catch {
    // Fall back to polling on filesystems where fs.watch fails
    isPolling = true;
    fs.watchFile(configPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        handleFileChange();
      }
    });
  }

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (isPolling) {
      fs.unwatchFile(configPath);
      isPolling = false;
    }
  };
}

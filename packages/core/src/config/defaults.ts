import { PgmoatConfig, type PgmoatConfigT } from './schema.js';

export function buildZeroConfig(url: string): PgmoatConfigT {
  return PgmoatConfig.parse({
    version: 1,
    server: {
      name: 'pgmoat',
      description: '',
    },
    transport: 'stdio',
    connection: {
      url,
      schemas: ['public'],
    },
    mode: 'read-only',
    budgets: {},
    rls: {},
    policy: {},
    tables: {},
    audit: {
      destination: 'file',
    },
    doctor: {
      on_start: 'warn',
    },
  });
}

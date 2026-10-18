import { createPolicyIndex, type ExtendedPolicyIndex } from '../fixtures/policy-index.js';

export const corpusPolicyIndex: ExtendedPolicyIndex = createPolicyIndex({
  exposedSchemas: ['public'],
  knownRelations: [
    'public.users',
    'public.orders',
    'public.tickets',
    'public.customers',
    'public.events',
  ],
  hiddenRelations: [
    'public.internal_audit',
    'public.api_keys',
  ],
  hiddenColumns: {
    'public.users': ['password_hash', 'mfa_secret'],
  },
  visibleColumns: {
    'public.users': [
      'id',
      'name',
      'email',
      'created_at',
      'updated_at',
      'tenant_id',
      'role',
    ],
    'public.orders': ['id', 'user_id', 'amount', 'status', 'created_at'],
    'public.tickets': ['id', 'user_id', 'title', 'status', 'created_at'],
    'public.customers': ['id', 'name', 'tier', 'created_at'],
    'public.events': ['id', 'event_type', 'payload', 'created_at'],
  },
});

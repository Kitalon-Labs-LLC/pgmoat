import { describe, it, expectTypeOf } from 'vitest';
import type {
  SafetyResult,
  AuditEntry,
  RequestContext,
  RowsResult,
  SchemaSnapshot,
  RelationInfo,
} from '../../src/types.js';

describe('runtime types', () => {
  it('narrows SafetyResult discriminated union on allowed property', () => {
    const res = {} as SafetyResult;

    if (res.allowed) {
      expectTypeOf(res.sql).toBeString();
      expectTypeOf(res.fingerprint).toBeString();
      expectTypeOf(res.limitInjected).toBeBoolean();
      expectTypeOf(res.statementType).toEqualTypeOf<
        'select' | 'explain' | 'show'
      >();
    } else {
      expectTypeOf(res.code).toBeString();
      expectTypeOf(res.message).toBeString();
      expectTypeOf(res.hint).toEqualTypeOf<string | undefined>();
      expectTypeOf(res.node).toEqualTypeOf<string | undefined>();
    }
  });

  it('validates AuditEntry status union', () => {
    expectTypeOf<AuditEntry['status']>().toEqualTypeOf<
      'success' | 'refused' | 'error' | 'canceled'
    >();
  });

  it('validates RequestContext structure', () => {
    expectTypeOf<RequestContext['transport']>().toEqualTypeOf<
      'stdio' | 'http'
    >();
    expectTypeOf<RequestContext['startedAt']>().toEqualTypeOf<Date>();
  });

  it('validates RowsResult wire structure', () => {
    expectTypeOf<RowsResult['row_count']>().toBeNumber();
    expectTypeOf<RowsResult['truncated']>().toBeBoolean();
  });

  it('validates SchemaSnapshot properties', () => {
    expectTypeOf<SchemaSnapshot['relations']>().toEqualTypeOf<RelationInfo[]>();
    expectTypeOf<SchemaSnapshot['hiddenCount']>().toBeNumber();
  });
});

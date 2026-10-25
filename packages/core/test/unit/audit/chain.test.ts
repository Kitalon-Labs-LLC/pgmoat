import { describe, it, expect } from 'vitest';
import { Chain } from '../../../src/audit/chain.js';
import { verifyAuditEntries } from '../../../src/audit/verify.js';
import type { AuditEntry } from '../../../src/types.js';

function createMockEntry(requestId: string, tool = 'query'): AuditEntry {
  return {
    request_id: requestId,
    instance_id: '',
    seq: 0,
    ts: '2026-10-18T12:00:00.000Z',
    transport: 'stdio',
    protocol_version: '2026-07-28',
    client_name: 'test',
    client_version: '1.0.0',
    principal: 'local',
    trace_id: null,
    tool,
    params: { sql: 'SELECT 1' },
    sql_executed: 'SELECT 1',
    sql_fingerprint: 'SELECT $1',
    rls_context: null,
    status: 'success',
    error_code: null,
    error_message: null,
    warnings: [],
    rows_returned: 1,
    rows_affected: null,
    duration_ms: 5,
    budget_max_rows: 200,
    budget_max_query_ms: 5000,
    payload_bytes: 100,
    prev_hash: '',
    entry_hash: '',
    dropped_since_last: 0,
    unsafe_role_override: false,
    pgmoat_version: '0.0.0',
    server_name: 'pgmoat',
  };
}

describe('Chain and Verify', () => {
  it('seals and verifies 1,000 entries as 100% intact', () => {
    const chain = new Chain('inst-1000');
    const entries: AuditEntry[] = [];

    for (let i = 0; i < 1000; i++) {
      const entry = createMockEntry(`req-${i}`);
      entries.push(chain.seal(entry));
    }

    expect(entries[0]?.seq).toBe(0);
    expect(entries[0]?.prev_hash).toBe('genesis:inst-1000');
    expect(entries[999]?.seq).toBe(999);

    const report = verifyAuditEntries(entries);
    expect(report.allIntact).toBe(true);
    expect(report.totalEntries).toBe(1000);
    expect(report.instances).toHaveLength(1);
    expect(report.instances[0]?.status).toBe('intact');
    expect(report.instances[0]?.intact).toBe(true);
    expect(report.instances[0]?.firstSeq).toBe(0);
    expect(report.instances[0]?.lastSeq).toBe(999);
  });

  it('detects tampering/editing of a field at the exact seq', () => {
    const chain = new Chain('inst-edit');
    const entries: AuditEntry[] = [];

    for (let i = 0; i < 20; i++) {
      entries.push(chain.seal(createMockEntry(`req-${i}`)));
    }

    // Tamper with seq 12
    const tampered = entries.map((e) => ({ ...e }));
    const target = tampered[12];
    if (target) {
      target.duration_ms = 9999; // modified field
    }

    const report = verifyAuditEntries(tampered);
    expect(report.allIntact).toBe(false);
    expect(report.instances[0]?.status).toBe('edited');
    expect(report.instances[0]?.badSeq).toBe(12);
    expect(report.instances[0]?.reason).toContain('entry_hash mismatch');
  });

  it('detects deletion of an entry as a sequence gap', () => {
    const chain = new Chain('inst-gap');
    const entries: AuditEntry[] = [];

    for (let i = 0; i < 20; i++) {
      entries.push(chain.seal(createMockEntry(`req-${i}`)));
    }

    // Delete seq 7
    const withGap = entries.filter((e) => e.seq !== 7);

    const report = verifyAuditEntries(withGap);
    expect(report.allIntact).toBe(false);
    expect(report.instances[0]?.status).toBe('gap');
    expect(report.instances[0]?.badSeq).toBe(8);
    expect(report.instances[0]?.gapDetails).toEqual({
      expectedSeq: 7,
      actualSeq: 8,
    });
  });

  it('detects reordered entries in the input', () => {
    const chain = new Chain('inst-swap');
    const entries: AuditEntry[] = [];

    for (let i = 0; i < 10; i++) {
      entries.push(chain.seal(createMockEntry(`req-${i}`)));
    }

    // Swap entry 3 and 4 in file order
    const swapped = [...entries];
    const item3 = swapped[3];
    const item4 = swapped[4];
    if (item3 && item4) {
      swapped[3] = item4;
      swapped[4] = item3;
    }

    const report = verifyAuditEntries(swapped);
    // When sorted, the chain itself is intact, but reordered flag is raised
    expect(report.allIntact).toBe(true);
    expect(report.instances[0]?.reordered).toBe(true);
  });

  it('reports recorded drops separately and preserves intact status', () => {
    const chain = new Chain('inst-drop');
    const entries: AuditEntry[] = [];

    // First entry at seq 0
    entries.push(chain.seal(createMockEntry('req-0')));

    // Buffer drops 5 entries before sealing can happen
    chain.noteDrop(5);

    // Next sealed entry gets seq 1, but dropped_since_last = 5
    const nextEntry = chain.seal(createMockEntry('req-1'));
    entries.push(nextEntry);

    expect(nextEntry.seq).toBe(1);
    expect(nextEntry.dropped_since_last).toBe(5);

    const report = verifyAuditEntries(entries);
    expect(report.allIntact).toBe(true);
    expect(report.instances[0]?.droppedRecorded).toBe(5);
  });

  it('verifies entries from multiple independent instances', () => {
    const chainA = new Chain('inst-A');
    const chainB = new Chain('inst-B');

    const entriesA = Array.from({ length: 10 }, (_, i) =>
      chainA.seal(createMockEntry(`req-A-${i}`)),
    );
    const entriesB = Array.from({ length: 15 }, (_, i) =>
      chainB.seal(createMockEntry(`req-B-${i}`)),
    );

    // Interleave entries from both instances
    const combined: AuditEntry[] = [];
    for (let i = 0; i < 15; i++) {
      if (entriesA[i]) combined.push(entriesA[i]);
      if (entriesB[i]) combined.push(entriesB[i]);
    }

    const report = verifyAuditEntries(combined);
    expect(report.allIntact).toBe(true);
    expect(report.totalEntries).toBe(25);
    expect(report.instances).toHaveLength(2);

    const instA = report.instances.find((i) => i.instanceId === 'inst-A');
    const instB = report.instances.find((i) => i.instanceId === 'inst-B');
    expect(instA?.totalEntries).toBe(10);
    expect(instB?.totalEntries).toBe(15);
  });
});


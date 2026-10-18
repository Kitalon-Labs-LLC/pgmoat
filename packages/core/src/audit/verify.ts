import type { AuditEntry } from '../types.js';
import { canonicalJson } from './canonical.js';
import { sha256hex } from './chain.js';

export type InstanceVerifyStatus = 'intact' | 'edited' | 'gap';

export interface InstanceVerifyResult {
  instanceId: string;
  status: InstanceVerifyStatus;
  totalEntries: number;
  firstSeq: number;
  lastSeq: number;
  intact: boolean;
  badSeq?: number;
  reason?: string;
  gapDetails?: { expectedSeq: number; actualSeq: number };
  droppedRecorded: number;
  reordered: boolean;
}

export interface VerifyReport {
  allIntact: boolean;
  totalEntries: number;
  instances: InstanceVerifyResult[];
}

/**
 * Verifies the cryptographic integrity of audit entries.
 * Groups by instance_id, sorts by seq, recomputes SHA-256 hashes,
 * and reports intact status, edits, sequence gaps, recorded drops, and reordering.
 */
export function verifyAuditEntries(entries: readonly AuditEntry[]): VerifyReport {
  if (entries.length === 0) {
    return {
      allIntact: true,
      totalEntries: 0,
      instances: [],
    };
  }

  // 1. Group entries by instance_id preserving observed file order
  const instanceMap = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    let list = instanceMap.get(entry.instance_id);
    if (!list) {
      list = [];
      instanceMap.set(entry.instance_id, list);
    }
    list.push(entry);
  }

  const instanceResults: InstanceVerifyResult[] = [];
  let allIntact = true;

  for (const [instanceId, rawList] of instanceMap.entries()) {
    // Check if original file order was already sorted by seq
    let reordered = false;
    for (let i = 1; i < rawList.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      if ((rawList[i]?.seq ?? 0) < (rawList[i - 1]?.seq ?? 0)) {
        reordered = true;
        break;
      }
    }

    // Sort by seq ascending
    const sorted = [...rawList].sort((a, b) => a.seq - b.seq);
    const firstSeq = sorted[0]?.seq ?? 0;
    const lastSeq = sorted[sorted.length - 1]?.seq ?? 0;

    let expectedPrevHash =
      firstSeq === 0 ? `genesis:${instanceId}` : (sorted[0]?.prev_hash ?? '');
    let expectedSeq = firstSeq;
    let droppedRecorded = 0;
    let status: InstanceVerifyStatus = 'intact';
    let badSeq: number | undefined;
    let reason: string | undefined;
    let gapDetails: { expectedSeq: number; actualSeq: number } | undefined;

    for (const entry of sorted) {
      // Check sequence gaps
      if (entry.seq !== expectedSeq) {
        status = 'gap';
        badSeq = entry.seq;
        reason = `Sequence gap: expected seq ${expectedSeq}, got ${entry.seq}`;
        gapDetails = { expectedSeq, actualSeq: entry.seq };
        break;
      }

      // Check drop accounting
      if (entry.dropped_since_last > 0) {
        droppedRecorded += entry.dropped_since_last;
      }

      // Check prev_hash
      if (entry.prev_hash !== expectedPrevHash) {
        status = 'edited';
        badSeq = entry.seq;
        reason = `prev_hash mismatch: expected "${expectedPrevHash}", got "${entry.prev_hash}"`;
        break;
      }

      // Recompute entry_hash
      const { entry_hash: originalHash, ...toHash } = entry;
      const canonical = canonicalJson(toHash);
      const computedHash = sha256hex(`${entry.prev_hash}\n${canonical}`);

      if (computedHash !== originalHash) {
        status = 'edited';
        badSeq = entry.seq;
        reason = `entry_hash mismatch: expected "${computedHash}", got "${originalHash}"`;
        break;
      }

      expectedPrevHash = entry.entry_hash;
      expectedSeq = entry.seq + 1;
    }

    const isInstanceIntact = status === 'intact';
    if (!isInstanceIntact) {
      allIntact = false;
    }

    instanceResults.push({
      instanceId,
      status,
      totalEntries: sorted.length,
      firstSeq,
      lastSeq,
      intact: isInstanceIntact,
      ...(badSeq !== undefined ? { badSeq } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(gapDetails !== undefined ? { gapDetails } : {}),
      droppedRecorded,
      reordered,
    });
  }

  return {
    allIntact,
    totalEntries: entries.length,
    instances: instanceResults,
  };
}

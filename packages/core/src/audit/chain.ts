import { createHash } from 'node:crypto';
import type { AuditEntry } from '../types.js';
import { canonicalJson } from './canonical.js';

export function sha256hex(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Manages an append-only cryptographic hash chain for a specific instance.
 *
 * Each entry is sealed with:
 *   prev_hash  = previous entry_hash (or "genesis:<instanceId>" for seq 0)
 *   seq        = strictly monotonically increasing integer starting at 0
 *   entry_hash = sha256hex(prev_hash + "\n" + canonicalJson(entry without entry_hash))
 */
export class Chain {
  private readonly _instanceId: string;
  private _nextSeq: number;
  private _lastHash: string;
  private _droppedSinceLast: number;

  constructor(instanceId: string, initialSeq = 0, initialHash?: string) {
    this._instanceId = instanceId;
    this._nextSeq = initialSeq;
    this._lastHash = initialHash ?? `genesis:${instanceId}`;
    this._droppedSinceLast = 0;
  }

  get instanceId(): string {
    return this._instanceId;
  }

  get nextSeq(): number {
    return this._nextSeq;
  }

  get lastHash(): string {
    return this._lastHash;
  }

  get droppedSinceLast(): number {
    return this._droppedSinceLast;
  }

  /**
   * Records that an entry was dropped prior to sealing due to buffer exhaustion.
   * Drops happen before sealing, so sealing never consumes a seq for a dropped entry.
   * The next successfully sealed entry records dropped_since_last.
   */
  noteDrop(count = 1): void {
    this._droppedSinceLast += count;
  }

  /**
   * Seals an AuditEntry by setting seq, prev_hash, dropped_since_last,
   * computing entry_hash, advancing the head of the chain, and resetting dropped counter.
   */
  seal(entry: AuditEntry): AuditEntry {
    entry.instance_id = this._instanceId;
    entry.seq = this._nextSeq++;
    entry.prev_hash = this._lastHash;
    entry.dropped_since_last = this._droppedSinceLast;

    // Canonical JSON over entry without entry_hash
    const toHash: Partial<AuditEntry> = { ...entry };
    delete toHash.entry_hash;
    const canonical = canonicalJson(toHash);

    entry.entry_hash = sha256hex(`${entry.prev_hash}\n${canonical}`);

    this._lastHash = entry.entry_hash;
    this._droppedSinceLast = 0;

    return entry;
  }
}

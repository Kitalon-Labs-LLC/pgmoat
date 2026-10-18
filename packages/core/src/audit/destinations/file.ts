/* eslint-disable security/detect-non-literal-fs-filename */
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry } from '../../types.js';
import type { AuditDestination } from '../pipeline.js';
import { getDefaultAuditDir } from '../paths.js';

// eslint-disable-next-line security/detect-unsafe-regex
export const AUDIT_FILE_REGEX = /^audit-([0-9]{4}-[0-9]{2}-[0-9]{2})(?:-([0-9]+))?\.ndjson$/;

export interface FileDestinationClock {
  now(): number;
}

export interface FileDestinationOptions {
  dir?: string;
  rotation?: 'daily' | string; // 'daily' | 'size:<N>(KB|MB|GB)'
  clock?: FileDestinationClock;
  fsyncOnRotation?: boolean;
}

export interface PruneResult {
  deleted: string[];
  preserved: string[];
  bytesFreed: number;
}

export function parseRotationConfig(rotation?: string): { mode: 'daily' } | { mode: 'size'; maxBytes: number } {
  if (!rotation || rotation === 'daily') {
    return { mode: 'daily' };
  }
  const match = rotation.match(/^size:(\d+)(KB|MB|GB)$/i);
  if (!match || !match[1] || !match[2]) {
    return { mode: 'daily' };
  }
  const num = parseInt(match[1], 10);
  const unit = match[2].toUpperCase();
  let multiplier = 1024;
  if (unit === 'MB') {
    multiplier = 1024 * 1024;
  } else if (unit === 'GB') {
    multiplier = 1024 * 1024 * 1024;
  }
  return { mode: 'size', maxBytes: num * multiplier };
}

export function formatUtcDate(timestamp: number): string {
  const d = new Date(timestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export class FileDestination implements AuditDestination {
  readonly name = 'file';
  private readonly dir: string;
  private readonly rotation: { mode: 'daily' } | { mode: 'size'; maxBytes: number };
  private readonly clock: FileDestinationClock;
  private readonly fsyncOnRotation: boolean;

  private currentHandle: fs.promises.FileHandle | null = null;
  private currentFilePath: string | null = null;
  private currentDateStr: string | null = null;
  private currentFileBytes = 0;
  private currentFileIndex = 0; // 0 means audit-YYYY-MM-DD.ndjson, >0 means audit-YYYY-MM-DD-N.ndjson

  constructor(options?: FileDestinationOptions) {
    this.dir = options?.dir ?? getDefaultAuditDir();
    this.rotation = parseRotationConfig(options?.rotation);
    this.clock = options?.clock ?? { now: () => Date.now() };
    this.fsyncOnRotation = options?.fsyncOnRotation ?? true;
  }

  get destinationDir(): string {
    return this.dir;
  }

  get activeFilePath(): string | null {
    return this.currentFilePath;
  }

  private async ensureDirectory(): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      try {
        await fs.promises.chmod(this.dir, 0o700);
      } catch {
        // Ignore if chmod fails (e.g. read-only filesystem or restricted permissions)
      }
    }
  }

  private async closeCurrentHandle(): Promise<void> {
    if (this.currentHandle) {
      if (this.fsyncOnRotation) {
        try {
          await this.currentHandle.sync();
        } catch {
          // Ignore sync failure on close
        }
      }
      try {
        await this.currentHandle.close();
      } catch {
        // Ignore close failure
      }
      this.currentHandle = null;
    }
  }

  private getFilenameFor(dateStr: string, index: number): string {
    if (index === 0) {
      return `audit-${dateStr}.ndjson`;
    }
    return `audit-${dateStr}-${index}.ndjson`;
  }

  private async initOrRotateHandle(bytesToWrite: number): Promise<void> {
    const now = this.clock.now();
    const todayStr = formatUtcDate(now);

    let needsRotate = false;

    if (!this.currentHandle || this.currentDateStr !== todayStr) {
      needsRotate = true;
      if (this.currentDateStr !== todayStr) {
        this.currentDateStr = todayStr;
        this.currentFileIndex = 0;
      }
    } else if (
      this.rotation.mode === 'size' &&
      this.currentFileBytes + bytesToWrite > this.rotation.maxBytes
    ) {
      needsRotate = true;
      this.currentFileIndex += 1;
    }

    if (!needsRotate && this.currentHandle) {
      return;
    }

    // Close previous file handle with sync
    await this.closeCurrentHandle();
    await this.ensureDirectory();

    // If starting on a date or size rotation, determine initial file path & size
    let targetFilePath = path.join(this.dir, this.getFilenameFor(todayStr, this.currentFileIndex));

    if (this.rotation.mode === 'size' && this.currentFileIndex === 0) {
      // Check existing files for today to find appropriate file and index
      try {
        const files = await fs.promises.readdir(this.dir);
        const prefix = `audit-${todayStr}`;
        const todayFiles = files.filter(
          (f) => f === `${prefix}.ndjson` || f.startsWith(`${prefix}-`),
        );
        if (todayFiles.length > 0) {
          // Find the highest index file
          let maxIndex = 0;
          for (const f of todayFiles) {
            const m = f.match(AUDIT_FILE_REGEX);
            if (m && m[1] === todayStr) {
              const idx = m[2] ? parseInt(m[2], 10) : 0;
              if (idx > maxIndex) {
                maxIndex = idx;
              }
            }
          }
          const candidatePath = path.join(this.dir, this.getFilenameFor(todayStr, maxIndex));
          try {
            const st = await fs.promises.stat(candidatePath);
            if (st.size + bytesToWrite <= this.rotation.maxBytes) {
              this.currentFileIndex = maxIndex;
              targetFilePath = candidatePath;
            } else {
              this.currentFileIndex = maxIndex + 1;
              targetFilePath = path.join(this.dir, this.getFilenameFor(todayStr, this.currentFileIndex));
            }
          } catch {
            this.currentFileIndex = maxIndex;
            targetFilePath = candidatePath;
          }
        }
      } catch {
        // readdir failed, use default
      }
    }

    // Open file handle with append mode and 0600 permissions
    const handle = await fs.promises.open(targetFilePath, 'a', 0o600);
    if (process.platform !== 'win32') {
      try {
        await fs.promises.chmod(targetFilePath, 0o600);
      } catch {
        // Ignore chmod errors
      }
    }

    const stat = await handle.stat();
    this.currentHandle = handle;
    this.currentFilePath = targetFilePath;
    this.currentFileBytes = stat.size;
  }

  async write(entries: readonly AuditEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const lines = entries.map((e) => JSON.stringify(e) + '\n').join('');
    const bytes = Buffer.byteLength(lines, 'utf-8');

    await this.initOrRotateHandle(bytes);

    if (this.currentHandle) {
      await this.currentHandle.appendFile(lines, 'utf-8');
      this.currentFileBytes += bytes;
    }
  }

  async close(): Promise<void> {
    await this.closeCurrentHandle();
    this.currentFilePath = null;
    this.currentDateStr = null;
    this.currentFileBytes = 0;
    this.currentFileIndex = 0;
  }
}

/**
 * Prunes audit files older than the specified retention period.
 */
export async function prune(
  dir: string,
  olderThanDays: number,
  dryRun = false,
  clock: FileDestinationClock = { now: () => Date.now() },
): Promise<PruneResult> {
  const result: PruneResult = {
    deleted: [],
    preserved: [],
    bytesFreed: 0,
  };

  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return result;
  }

  const now = clock.now();
  const cutoffMs = olderThanDays * 86_400_000;

  for (const filename of files) {
    const match = filename.match(AUDIT_FILE_REGEX);
    if (!match) {
      continue;
    }

    const dateStr = match[1];
    const fileTime = new Date(`${dateStr}T00:00:00.000Z`).getTime();
    if (isNaN(fileTime)) {
      continue;
    }

    const filePath = path.join(dir, filename);
    const ageMs = now - fileTime;

    if (ageMs > cutoffMs) {
      try {
        const stat = await fs.promises.stat(filePath);
        result.bytesFreed += stat.size;
        result.deleted.push(filePath);
        if (!dryRun) {
          await fs.promises.unlink(filePath);
        }
      } catch {
        // If file stat or unlink fails, skip
      }
    } else {
      result.preserved.push(filePath);
    }
  }

  return result;
}

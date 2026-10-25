import { PGMOAT_VERSION, parseSql } from '@pgmoat/core';
import { isJson } from '../output.js';

export const SUPPORTED_PROTOCOLS = ['2026-07-28', '2025-11-25'] as const;

export interface VersionInfo {
  pgmoat: string;
  node: string;
  parser: number;
  protocols: string[];
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const parseRes = await parseSql('SELECT 1');
  return {
    pgmoat: PGMOAT_VERSION,
    node: process.version,
    parser: parseRes.grammarVersion,
    protocols: [...SUPPORTED_PROTOCOLS],
  };
}

export async function versionCommand(): Promise<void> {
  const info = await getVersionInfo();
  if (isJson()) {
    process.stdout.write(JSON.stringify(info) + '\n');
  } else {
    process.stdout.write(
      `pgmoat ${info.pgmoat}\nnode ${info.node}\nparser grammar ${info.parser}\nprotocols ${info.protocols.join(', ')}\n`,
    );
  }
}


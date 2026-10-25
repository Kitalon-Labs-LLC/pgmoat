import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { PgmoatError, refuse } from '../errors.js';
import { PgmoatConfig, type PgmoatConfigT } from './schema.js';
import { checkConfig } from './checks.js';
import { interpolate } from './interpolate.js';

export interface LoadConfigOptions {
  path?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  strict?: boolean;
}

export type FindConfigResult =
  | { kind: 'file'; path: string }
  | { kind: 'none' };

export type LoadConfigResult =
  | {
      kind: 'file';
      path: string;
      config: PgmoatConfigT;
      warnings: PgmoatError[];
    }
  | {
      kind: 'none';
    };

export function findConfig(options: LoadConfigOptions = {}): FindConfigResult {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  // 1. Explicit path
  if (options.path) {
    const resolved = path.resolve(cwd, options.path);
    if (fs.existsSync(resolved)) {
      return { kind: 'file', path: resolved };
    }
    throw refuse('PGM-109', `Config file not found at: ${resolved}. Run 'pgmoat init' to create one, or start with 'pgmoat <postgres-url>'.`);
  }

  // 2. $PGMOAT_CONFIG
  if (env.PGMOAT_CONFIG) {
    const resolved = path.resolve(cwd, env.PGMOAT_CONFIG);
    if (fs.existsSync(resolved)) {
      return { kind: 'file', path: resolved };
    }
  }

  // 3. ./pgmoat.yaml
  const localYaml = path.resolve(cwd, 'pgmoat.yaml');
  if (fs.existsSync(localYaml)) {
    return { kind: 'file', path: localYaml };
  }

  // 4. ~/.config/pgmoat/config.yaml (respecting XDG_CONFIG_HOME)
  const xdgConfigHome =
    env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? os.homedir(), '.config');
  const userConfig = path.join(xdgConfigHome, 'pgmoat', 'config.yaml');
  if (fs.existsSync(userConfig)) {
    return { kind: 'file', path: userConfig };
  }

  // 5. /etc/pgmoat/config.yaml
  const systemConfig = '/etc/pgmoat/config.yaml';
  if (fs.existsSync(systemConfig)) {
    return { kind: 'file', path: systemConfig };
  }

  return { kind: 'none' };
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    deepFreeze(value);
  }
  return obj;
}

export function loadConfig(options: LoadConfigOptions = {}): LoadConfigResult {
  const env = options.env ?? process.env;
  const found = findConfig(options);
  if (found.kind === 'none') {
    return { kind: 'none' };
  }

  const filePath = found.path;
  const rawContent = fs.readFileSync(filePath, 'utf8');

  const lineCounter = new yaml.LineCounter();
  const doc = yaml.parseDocument(rawContent, { lineCounter });

  if (doc.errors.length > 0) {
    const firstErr = doc.errors[0];
    const pos = firstErr?.linePos?.[0] ?? { line: 1, col: 1 };
    throw refuse(
      'PGM-107',
      `${path.basename(filePath)}:${pos.line}:${pos.col} YAML syntax error: ${firstErr?.message ?? 'unknown syntax error'}`,
    );
  }

  // Interpolate ${VAR} and ${file:...}
  interpolate(doc, env, (p) => fs.readFileSync(p, 'utf8'));

  const parsedJs = doc.toJS();
  const parseResult = PgmoatConfig.safeParse(parsedJs);

  const errors: string[] = [];

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      let node: unknown = doc.getIn(issue.path, true);
      const searchPath = [...issue.path];
      while (!node && searchPath.length > 0) {
        searchPath.pop();
        node = doc.getIn(searchPath, true);
      }

      let line = 1;
      let col = 1;
      const parsedNode = node as { range?: [number, number, number] };
      if (parsedNode && Array.isArray(parsedNode.range)) {
        const pos = lineCounter.linePos(parsedNode.range[0]);
        line = pos.line;
        col = pos.col;
      }

      const fieldPath = issue.path.join('.');
      errors.push(
        `${path.basename(filePath)}:${line}:${col} ${fieldPath}: ${issue.message}`,
      );
    }
  }

  let warnings: PgmoatError[] = [];

  if (parseResult.success) {
    const checkOptions =
      options.strict !== undefined ? { strict: options.strict } : {};
    const checkRes = checkConfig(parseResult.data, checkOptions);
    warnings = checkRes.warnings;

    for (const err of checkRes.errors) {
      errors.push(`${path.basename(filePath)}: ${err.code}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    const formatted = errors.join('\n');
    throw refuse('PGM-109', `Config validation failed:\n${formatted}`);
  }

  // Type assertion is safe here as errors would have been thrown
  const validConfig = deepFreeze((parseResult as { data: PgmoatConfigT }).data);

  return {
    kind: 'file',
    path: filePath,
    config: validConfig,
    warnings,
  };
}

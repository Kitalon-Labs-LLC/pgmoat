import yaml from 'yaml';
import { refuse } from '../errors.js';

export type ReadFileFn = (path: string) => string;
export type EnvMap = Record<string, string | undefined>;

export function interpolateString(
  str: string,
  env: EnvMap,
  readFile: ReadFileFn,
  pathStr: string,
): string {
  return str.replace(/(\$\$|\$)\{([^}]+)\}/g, (_match, prefix, content) => {
    // Escaped syntax: $${VAR} -> ${VAR}
    if (prefix === '$$') {
      return `\${${content}}`;
    }

    // File interpolation: ${file:/abs/path}
    if (content.startsWith('file:')) {
      const filePath = content.slice(5);
      if (!filePath.startsWith('/')) {
        throw refuse(
          'PGM-108',
          `File interpolation path "${filePath}" at "${pathStr}" must be an absolute path`,
        );
      }
      try {
        const raw = readFile(filePath);
        return raw.replace(/\r?\n$/, '');
      } catch (err) {
        throw refuse(
          'PGM-108',
          `File "${filePath}" for interpolation at "${pathStr}" could not be read: ${(err as Error).message}`,
        );
      }
    }

    // Environment variable interpolation: ${VAR} or ${VAR:-default}
    const idx = content.indexOf(':-');
    let varName = content;
    let defaultVal: string | undefined = undefined;
    if (idx !== -1) {
      varName = content.slice(0, idx);
      defaultVal = content.slice(idx + 2);
    }

    // eslint-disable-next-line security/detect-object-injection
    const val = env[varName];
    if (val !== undefined && val !== '') {
      return val;
    }
    if (defaultVal !== undefined) {
      return defaultVal;
    }

    throw refuse(
      'PGM-108',
      `Environment variable "${varName}" missing for interpolation at "${pathStr}"`,
    );
  });
}

function isYamlDocument(doc: unknown): doc is yaml.Document {
  return (
    doc != null &&
    typeof doc === 'object' &&
    'contents' in doc &&
    typeof (doc as yaml.Document).toJS === 'function'
  );
}

function interpolateValue(
  value: unknown,
  env: EnvMap,
  readFile: ReadFileFn,
  currentPath: string,
): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, env, readFile, currentPath);
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      interpolateValue(
        item,
        env,
        readFile,
        currentPath ? `${currentPath}.${idx}` : `${idx}`,
      ),
    );
  }
  if (value !== null && typeof value === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const nextPath = currentPath ? `${currentPath}.${k}` : k;
      // Keys are never interpolated
      // eslint-disable-next-line security/detect-object-injection
      res[k] = interpolateValue(v, env, readFile, nextPath);
    }
    return res;
  }
  return value;
}

export function interpolate(
  doc: unknown,
  env: EnvMap,
  readFile: ReadFileFn,
): unknown {
  if (isYamlDocument(doc)) {
    yaml.visit(doc, {
      Scalar(key, node, path) {
        // Only interpolate scalar values, never map keys
        if (typeof node.value === 'string' && key !== 'key') {
          const parts: string[] = [];
          const pathArray = Array.from(path);
          pathArray.forEach((item, i) => {
            if (yaml.isPair(item) && item.key) {
              const pairKey = item.key as { value?: unknown };
              parts.push(String(pairKey.value ?? item.key));
            } else if (yaml.isSeq(item)) {
              const next = pathArray[i + 1] ?? node;
              const idx = item.items.indexOf(next as yaml.ParsedNode);
              if (idx !== -1) {
                parts.push(String(idx));
              }
            }
          });
          const pathStr = parts.join('.');
          node.value = interpolateString(node.value, env, readFile, pathStr);
        }
      },
    });
    return doc;
  }

  return interpolateValue(doc, env, readFile, '');
}

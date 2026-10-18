import { describe, it, expect } from 'vitest';
import yaml from 'yaml';
import { interpolate } from '../../../src/config/interpolate.js';
import { isPgmoatError } from '../../../src/errors.js';

describe('config interpolation', () => {
  const dummyReadFile = (path: string): string => {
    if (path === '/secrets/db_password') {
      return 'supersecret123\n';
    }
    if (path === '/secrets/no_newline') {
      return 'justsecret';
    }
    throw new Error('ENOENT: no such file');
  };

  it('interpolates standard ${VAR}', () => {
    const doc = yaml.parseDocument('url: "postgresql://${DB_USER}@localhost"');
    interpolate(doc, { DB_USER: 'pguser' }, dummyReadFile);
    expect(doc.toJS()).toEqual({ url: 'postgresql://pguser@localhost' });
  });

  it('interpolates ${VAR:-default} when VAR is unset or empty', () => {
    const doc = yaml.parseDocument(
      'host: "${DB_HOST:-localhost}"\nport: "${DB_PORT:-5432}"',
    );
    interpolate(doc, { DB_PORT: '' }, dummyReadFile);
    expect(doc.toJS()).toEqual({ host: 'localhost', port: '5432' });

    const doc2 = yaml.parseDocument('host: "${DB_HOST:-localhost}"');
    interpolate(doc2, { DB_HOST: 'db.prod' }, dummyReadFile);
    expect(doc2.toJS()).toEqual({ host: 'db.prod' });
  });

  it('interpolates ${file:/abs/path} and strips one trailing newline', () => {
    const doc = yaml.parseDocument('pass: "${file:/secrets/db_password}"');
    interpolate(doc, {}, dummyReadFile);
    expect(doc.toJS()).toEqual({ pass: 'supersecret123' });

    const doc2 = yaml.parseDocument('pass: "${file:/secrets/no_newline}"');
    interpolate(doc2, {}, dummyReadFile);
    expect(doc2.toJS()).toEqual({ pass: 'justsecret' });
  });

  it('escapes $${VAR} to literal ${VAR} without expanding', () => {
    const doc = yaml.parseDocument(
      'template: "$${VAR_NAME}"\nnormal: "${VAR_NAME}"',
    );
    interpolate(doc, { VAR_NAME: 'expanded' }, dummyReadFile);
    expect(doc.toJS()).toEqual({
      template: '${VAR_NAME}',
      normal: 'expanded',
    });
  });

  it('throws PGM-108 with yaml path when environment variable is missing', () => {
    const doc = yaml.parseDocument(
      'connection:\n  url: "postgresql://${MISSING_USER}@localhost"',
    );

    try {
      interpolate(doc, {}, dummyReadFile);
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-108');
        expect(err.message).toContain('MISSING_USER');
        expect(err.message).toContain('connection.url');
      }
    }
  });

  it('throws PGM-108 when file path is not absolute', () => {
    const doc = yaml.parseDocument('pass: "${file:relative/path}"');
    try {
      interpolate(doc, {}, dummyReadFile);
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-108');
        expect(err.message).toContain('must be an absolute path');
      }
    }
  });

  it('throws PGM-108 when file cannot be read', () => {
    const doc = yaml.parseDocument('pass: "${file:/secrets/nonexistent}"');
    try {
      interpolate(doc, {}, dummyReadFile);
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-108');
        expect(err.message).toContain('could not be read');
      }
    }
  });

  it('leaves map keys and numbers untouched', () => {
    const doc = yaml.parseDocument(
      '${KEY_NAME}: value\nport: 5432\nenabled: true\n',
    );
    interpolate(doc, { KEY_NAME: 'replaced_key' }, dummyReadFile);
    const js = doc.toJS();
    // Key should NOT be interpolated
    expect(js['${KEY_NAME}']).toBe('value');
    expect(js.port).toBe(5432);
    expect(js.enabled).toBe(true);
  });

  it('works with plain JS objects', () => {
    const obj = {
      db: {
        url: 'postgresql://${DB_HOST:-localhost}:5432/db',
        pass: '${file:/secrets/db_password}',
      },
    };
    const res = interpolate(obj, {}, dummyReadFile);
    expect(res).toEqual({
      db: {
        url: 'postgresql://localhost:5432/db',
        pass: 'supersecret123',
      },
    });
  });
});

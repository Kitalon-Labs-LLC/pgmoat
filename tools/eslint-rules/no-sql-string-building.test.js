import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import rule from './no-sql-string-building.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('no-sql-string-building', rule, {
  valid: [
    // 1. Static template literal (no expressions)
    {
      code: 'const q = `SELECT * FROM users`;',
    },
    // 2. Non-SQL template literal with expressions
    {
      code: 'const greeting = `Hello, ${user.name}!`;',
    },
    // 3. Simple arithmetic addition
    {
      code: 'const sum = a + b + 10;',
    },
    // 4. Non-SQL string concatenation with variable
    {
      code: 'const msg = "Error processing request: " + err.message;',
    },
    // 5. Parameterized query with array
    {
      code: 'const res = db.query("SELECT * FROM users WHERE id = $1", [id]);',
    },
    // 6. Multi-line static SQL
    {
      code: 'const q = `\n  SELECT id, email\n  FROM users\n  WHERE active = true\n  LIMIT 10\n`;',
    },
    // 7. Non-keyword substrings that contain keyword letters but not whole word
    {
      code: 'const label = "selectivity: " + score;',
    },
    // 8. Concatenation of only string literals (no variable operand)
    {
      code: 'const q = "SELECT * " + "FROM users " + "WHERE id = 1";',
    },
  ],
  invalid: [
    // 1. Template literal with table name
    {
      code: 'const q = `SELECT * FROM ${table}`;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 2. Template literal with WHERE condition
    {
      code: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 3. Template literal with INSERT
    {
      code: 'const q = `INSERT INTO users (name) VALUES (${name})`;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 4. Template literal with UPDATE SET
    {
      code: 'const q = `UPDATE users SET name = ${name} WHERE id = 1`;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 5. Template literal with DELETE FROM
    {
      code: 'const q = `DELETE FROM users WHERE id = ${id}`;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 6. Concatenation with SELECT FROM
    {
      code: 'const q = "SELECT * FROM " + tableName;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 7. Concatenation with WHERE
    {
      code: 'const q = "SELECT * FROM users WHERE id = " + userId;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
    // 8. Concatenation with LIMIT / OFFSET
    {
      code: 'const q = baseQuery + " LIMIT " + count;',
      errors: [{ messageId: 'noSqlBuilding' }],
    },
  ],
});

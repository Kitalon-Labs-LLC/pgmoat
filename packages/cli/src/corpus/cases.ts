// Bundled corpus cases for CLI test-corpus
export interface CorpusCase {
  id: string;
  group: string;
  sql: string;
  config?: string;
  expect: {
    allowed?: boolean;
    refused?: string;
  };
  executes?: boolean;
  db_blocks?: boolean;
  note?: string;
}

export const BUNDLED_CASES: CorpusCase[] = [
  {
    "id": "allowed-001",
    "group": "allowed",
    "sql": "SELECT id, name FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-002",
    "group": "allowed",
    "sql": "SELECT count(*) FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-003",
    "group": "allowed",
    "sql": "SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-004",
    "group": "allowed",
    "sql": "WITH recent_users AS (SELECT id, created_at FROM users ORDER BY created_at DESC) SELECT * FROM recent_users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-005",
    "group": "allowed",
    "sql": "SHOW work_mem",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-006",
    "group": "allowed",
    "sql": "SELECT u.id, o.amount FROM users u LEFT JOIN orders o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-007",
    "group": "allowed",
    "sql": "SELECT u.id, o.amount FROM users u RIGHT JOIN orders o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-008",
    "group": "allowed",
    "sql": "SELECT u.id, o.amount FROM users u FULL JOIN orders o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-009",
    "group": "allowed",
    "sql": "SELECT u.id, c.name FROM users u CROSS JOIN customers c",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-010",
    "group": "allowed",
    "sql": "SELECT u.id, o.id AS order_id, t.id AS ticket_id FROM users u LEFT JOIN orders o ON u.id = o.user_id LEFT JOIN tickets t ON u.id = t.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-011",
    "group": "allowed",
    "sql": "SELECT u1.id, u2.name FROM users u1 JOIN users u2 ON u1.tenant_id = u2.tenant_id WHERE u1.id <> u2.id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-012",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE email = 'alice@example.com'",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-013",
    "group": "allowed",
    "sql": "SELECT id FROM orders WHERE amount > 100.50",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-014",
    "group": "allowed",
    "sql": "SELECT id FROM orders WHERE amount >= 50 AND status = 'completed'",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-015",
    "group": "allowed",
    "sql": "SELECT id FROM tickets WHERE status = 'open' OR status = 'pending'",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-016",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE NOT (role = 'banned')",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-017",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE id IN (1, 2, 3)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-018",
    "group": "allowed",
    "sql": "SELECT id FROM orders WHERE amount BETWEEN 10 AND 100",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-019",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE name LIKE 'John%'",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-020",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE name ILIKE '%smith%'",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-021",
    "group": "allowed",
    "sql": "SELECT id FROM tickets WHERE user_id IS NULL",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-022",
    "group": "allowed",
    "sql": "SELECT id FROM tickets WHERE user_id IS NOT NULL",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-023",
    "group": "allowed",
    "sql": "SELECT id FROM users WHERE id = ANY (ARRAY[10, 20, 30])",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-024",
    "group": "allowed",
    "sql": "SELECT id FROM orders WHERE amount > ALL (ARRAY[5, 10, 15])",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-025",
    "group": "allowed",
    "sql": "SELECT status, count(*), sum(amount), avg(amount), min(amount), max(amount) FROM orders GROUP BY status",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-026",
    "group": "allowed",
    "sql": "SELECT status, count(*) FROM orders GROUP BY status HAVING count(*) > 10",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-027",
    "group": "allowed",
    "sql": "SELECT status, count(*) FILTER (WHERE amount > 100) FROM orders GROUP BY status",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-028",
    "group": "allowed",
    "sql": "SELECT status, user_id, count(*) FROM orders GROUP BY GROUPING SETS ((status), (user_id), ())",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-029",
    "group": "allowed",
    "sql": "SELECT status, user_id, sum(amount) FROM orders GROUP BY ROLLUP (status, user_id)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-030",
    "group": "allowed",
    "sql": "SELECT status, user_id, sum(amount) FROM orders GROUP BY CUBE (status, user_id)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-031",
    "group": "allowed",
    "sql": "SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at) FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-032",
    "group": "allowed",
    "sql": "SELECT id, rank() OVER (ORDER BY amount DESC) FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-033",
    "group": "allowed",
    "sql": "SELECT id, dense_rank() OVER (ORDER BY amount DESC) FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-034",
    "group": "allowed",
    "sql": "SELECT id, lag(amount, 1) OVER (PARTITION BY user_id ORDER BY created_at) FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-035",
    "group": "allowed",
    "sql": "SELECT id, lead(amount, 1) OVER (PARTITION BY user_id ORDER BY created_at) FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-036",
    "group": "allowed",
    "sql": "SELECT id, first_value(amount) OVER (PARTITION BY user_id ORDER BY created_at) FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-037",
    "group": "allowed",
    "sql": "SELECT id, last_value(amount) OVER (PARTITION BY user_id ORDER BY created_at) FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-038",
    "group": "allowed",
    "sql": "SELECT id, ntile(4) OVER (ORDER BY amount) FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-039",
    "group": "allowed",
    "sql": "SELECT id FROM users UNION SELECT user_id FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-040",
    "group": "allowed",
    "sql": "SELECT id FROM users UNION ALL SELECT user_id FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-041",
    "group": "allowed",
    "sql": "SELECT id FROM users INTERSECT SELECT user_id FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-042",
    "group": "allowed",
    "sql": "SELECT id FROM users EXCEPT SELECT user_id FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-043",
    "group": "allowed",
    "sql": "WITH o AS (SELECT user_id, sum(amount) AS total FROM orders GROUP BY user_id) SELECT u.id, o.total FROM users u JOIN o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-044",
    "group": "allowed",
    "sql": "WITH u AS (SELECT id FROM users), o AS (SELECT id FROM orders) SELECT * FROM u, o",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-045",
    "group": "allowed",
    "sql": "WITH RECURSIVE nums AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM nums WHERE n < 10) SELECT n FROM nums",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-046",
    "group": "allowed",
    "sql": "SELECT lower(name), upper(name), length(name), trim(name) FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-047",
    "group": "allowed",
    "sql": "SELECT substr(name, 1, 4), concat(name, ' (user)') FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-048",
    "group": "allowed",
    "sql": "SELECT now(), current_date, current_time, date_trunc('day', created_at) FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-049",
    "group": "allowed",
    "sql": "SELECT extract(year FROM created_at), extract(month FROM created_at) FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-050",
    "group": "allowed",
    "sql": "SELECT abs(amount), round(amount), floor(amount), ceil(amount) FROM orders",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-051",
    "group": "allowed",
    "sql": "SELECT to_json(name), to_jsonb(email) FROM users",
    "expect": {
      "allowed": true
    },
    "executes": true
  },
  {
    "id": "allowed-052",
    "group": "allowed",
    "sql": "SELECT json_build_object('id', id, 'name', name) FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-053",
    "group": "allowed",
    "sql": "SELECT json_agg(name), jsonb_agg(email) FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-054",
    "group": "allowed",
    "sql": "SELECT array_agg(id ORDER BY id), array_length(ARRAY[1, 2, 3], 1) FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-055",
    "group": "allowed",
    "sql": "SELECT unnest(ARRAY['a', 'b', 'c'])",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-056",
    "group": "allowed",
    "sql": "SELECT DISTINCT tenant_id FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-057",
    "group": "allowed",
    "sql": "SELECT DISTINCT ON (tenant_id) id, name FROM users ORDER BY tenant_id, created_at DESC",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-058",
    "group": "allowed",
    "sql": "SELECT * FROM (VALUES (1, 'active'), (2, 'inactive')) AS t(id, status)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-059",
    "group": "allowed",
    "sql": "SELECT u.id, o.id AS order_id FROM users u, LATERAL (SELECT id FROM orders WHERE orders.user_id = u.id LIMIT 1) o",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-060",
    "group": "allowed",
    "sql": "SELECT id FROM users TABLESAMPLE SYSTEM (10)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-061",
    "group": "allowed",
    "sql": "SELECT coalesce(title, 'Untitled') FROM tickets",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-062",
    "group": "allowed",
    "sql": "SELECT nullif(status, 'unknown') FROM tickets",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-063",
    "group": "allowed",
    "sql": "SELECT CASE WHEN amount > 100 THEN 'large' ELSE 'small' END FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-064",
    "group": "allowed",
    "sql": "SELECT CASE status WHEN 'completed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-065",
    "group": "allowed",
    "sql": "SHOW server_version",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "allowed-066",
    "group": "allowed",
    "sql": "SELECT id FROM users ORDER BY created_at DESC, id ASC",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-001",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 201",
    "expect": {
      "refused": "PGM-302"
    },
    "note": "LIMIT 201 exceeds default max_rows budget of 200"
  },
  {
    "id": "budgets-002",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 500",
    "expect": {
      "refused": "PGM-302"
    },
    "note": "LIMIT 500 exceeds default max_rows budget of 200"
  },
  {
    "id": "budgets-003",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 10000",
    "expect": {
      "refused": "PGM-302"
    },
    "note": "LIMIT 10000 exceeds default max_rows budget of 200"
  },
  {
    "id": "budgets-004",
    "group": "budgets",
    "sql": "SELECT id FROM orders FETCH FIRST 201 ROWS ONLY",
    "expect": {
      "refused": "PGM-302"
    },
    "note": "FETCH FIRST 201 ROWS exceeds default max_rows budget of 200"
  },
  {
    "id": "budgets-005",
    "group": "budgets",
    "sql": "SELECT id FROM orders FETCH FIRST 1000 ROWS ONLY",
    "expect": {
      "refused": "PGM-302"
    },
    "note": "FETCH FIRST 1000 ROWS exceeds default max_rows budget of 200"
  },
  {
    "id": "budgets-006",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 200",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-007",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 50",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-008",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT 1",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-009",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT $1",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-010",
    "group": "budgets",
    "sql": "SELECT id FROM orders LIMIT (SELECT 10)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-011",
    "group": "budgets",
    "sql": "SELECT id FROM orders FETCH FIRST 10 ROWS ONLY",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "budgets-012",
    "group": "budgets",
    "sql": "SELECT id FROM orders OFFSET 1000",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "cte-001",
    "group": "cte",
    "sql": "WITH del AS (DELETE FROM users RETURNING id) SELECT * FROM del",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "DELETE statement inside Common Table Expression"
  },
  {
    "id": "cte-002",
    "group": "cte",
    "sql": "WITH ins AS (INSERT INTO users (id, name) VALUES (1, 'x') RETURNING id) SELECT * FROM ins",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "INSERT statement inside Common Table Expression"
  },
  {
    "id": "cte-003",
    "group": "cte",
    "sql": "WITH upd AS (UPDATE users SET name = 'hacked' RETURNING id) SELECT * FROM upd",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "UPDATE statement inside Common Table Expression"
  },
  {
    "id": "cte-004",
    "group": "cte",
    "sql": "WITH mrg AS (MERGE INTO users u USING orders o ON u.id = o.user_id WHEN MATCHED THEN DELETE RETURNING u.id) SELECT * FROM mrg",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "MERGE statement inside Common Table Expression"
  },
  {
    "id": "cte-005",
    "group": "cte",
    "sql": "WITH outer_cte AS (WITH inner_del AS (DELETE FROM users RETURNING id) SELECT * FROM inner_del) SELECT * FROM outer_cte",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "Nested writing CTE with DELETE"
  },
  {
    "id": "cte-006",
    "group": "cte",
    "sql": "SELECT * FROM (WITH del AS (DELETE FROM users RETURNING id) SELECT * FROM del) sub",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "Writing CTE inside FROM subquery"
  },
  {
    "id": "cte-007",
    "group": "cte",
    "sql": "SELECT * FROM users WHERE id IN (WITH del AS (DELETE FROM orders RETURNING user_id) SELECT user_id FROM del)",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "Writing CTE inside IN subquery"
  },
  {
    "id": "cte-008",
    "group": "cte",
    "sql": "SELECT * FROM users WHERE EXISTS (WITH del AS (DELETE FROM orders RETURNING id) SELECT id FROM del)",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "Writing CTE inside EXISTS subquery"
  },
  {
    "id": "cte-009",
    "group": "cte",
    "sql": "SELECT 1 UNION ALL (WITH del AS (DELETE FROM users RETURNING id) SELECT id FROM del)",
    "expect": {
      "refused": "PGM-203"
    },
    "db_blocks": true,
    "note": "Writing CTE inside set operation UNION"
  },
  {
    "id": "cte-010",
    "group": "cte",
    "sql": "WITH regional AS (SELECT id, tenant_id FROM users) SELECT * FROM regional",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "cte-011",
    "group": "cte",
    "sql": "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a, b",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "cte-012",
    "group": "cte",
    "sql": "WITH RECURSIVE t(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM t WHERE n < 5) SELECT n FROM t",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "cte-013",
    "group": "cte",
    "sql": "WITH outer_c AS (WITH inner_c AS (SELECT id FROM users) SELECT id FROM inner_c) SELECT * FROM outer_c",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-001",
    "group": "edge",
    "sql": "",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Empty string SQL input is refused with PGM-206"
  },
  {
    "id": "edge-002",
    "group": "edge",
    "sql": "    \n\t  ",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Whitespace-only SQL input is refused with PGM-206"
  },
  {
    "id": "edge-003",
    "group": "edge",
    "sql": "-- this is just a single line comment",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Comment-only SQL input is refused with PGM-206"
  },
  {
    "id": "edge-004",
    "group": "edge",
    "sql": "/* multi-line\n   block comment\n   only */",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Block-comment-only SQL input is refused with PGM-206"
  },
  {
    "id": "edge-005",
    "group": "edge",
    "sql": "SELECT * FROM",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Incomplete syntax missing relation is refused with PGM-206"
  },
  {
    "id": "edge-006",
    "group": "edge",
    "sql": "SELECT 1 WHERE %%% syntax error",
    "expect": {
      "refused": "PGM-206"
    },
    "note": "Malformed tokens and future PG syntax not recognized by parser yield PGM-206"
  },
  {
    "id": "edge-007",
    "group": "edge",
    "sql": "SELECT id AS \"имя\" FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-008",
    "group": "edge",
    "sql": "SELECT id AS \"témoin\" FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-009",
    "group": "edge",
    "sql": "SELECT id AS \"日本語\" FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-010",
    "group": "edge",
    "sql": "SELECT id AS \"select\", name AS \"from\", email AS \"where\" FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-011",
    "group": "edge",
    "sql": "SELECT id AS \"order\", name AS \"group\" FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-012",
    "group": "edge",
    "sql": "SELECT id FROM users WHERE id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-013",
    "group": "edge",
    "sql": "SELECT (SELECT (SELECT (SELECT (SELECT id FROM users LIMIT 1))))",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-014",
    "group": "edge",
    "sql": "SELECT $tag$Hello World$tag$ AS msg",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-015",
    "group": "edge",
    "sql": "SELECT $$line1\nline2$$ AS msg",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "edge-016",
    "group": "edge",
    "sql": "SELECT id, 'escape '' quotes' AS val FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "explain-001",
    "group": "explain",
    "sql": "EXPLAIN ANALYZE SELECT id FROM users",
    "expect": {
      "refused": "PGM-209"
    },
    "note": "EXPLAIN ANALYZE executes the query and is forbidden in read-only mode"
  },
  {
    "id": "explain-002",
    "group": "explain",
    "sql": "EXPLAIN (ANALYZE) SELECT id FROM users",
    "expect": {
      "refused": "PGM-209"
    },
    "note": "EXPLAIN option ANALYZE executes query and is forbidden in read-only mode"
  },
  {
    "id": "explain-003",
    "group": "explain",
    "sql": "EXPLAIN (ANALYZE true, BUFFERS) SELECT id FROM users",
    "expect": {
      "refused": "PGM-209"
    },
    "note": "EXPLAIN with explicit ANALYZE true option is forbidden in read-only mode"
  },
  {
    "id": "explain-004",
    "group": "explain",
    "sql": "EXPLAIN (ANALYZE 1) SELECT id FROM users",
    "expect": {
      "refused": "PGM-209"
    },
    "note": "EXPLAIN with ANALYZE 1 is forbidden in read-only mode"
  },
  {
    "id": "explain-005",
    "group": "explain",
    "sql": "EXPLAIN DELETE FROM users",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "EXPLAIN wrapping DELETE write statement is forbidden in read-only mode"
  },
  {
    "id": "explain-006",
    "group": "explain",
    "sql": "EXPLAIN INSERT INTO users (id, name) VALUES (1, 'alice')",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "EXPLAIN wrapping INSERT write statement is forbidden in read-only mode"
  },
  {
    "id": "explain-007",
    "group": "explain",
    "sql": "EXPLAIN UPDATE users SET name = 'bob' WHERE id = 1",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "EXPLAIN wrapping UPDATE write statement is forbidden in read-only mode"
  },
  {
    "id": "explain-008",
    "group": "explain",
    "sql": "EXPLAIN SELECT id FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "explain-009",
    "group": "explain",
    "sql": "EXPLAIN (ANALYZE false) SELECT id FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "explain-010",
    "group": "explain",
    "sql": "EXPLAIN (FORMAT JSON, COSTS true) SELECT id FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-001",
    "group": "functions",
    "sql": "SELECT pg_sleep(1)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_sleep causes denial of service by pausing backend execution"
  },
  {
    "id": "functions-002",
    "group": "functions",
    "sql": "SELECT pg_catalog.pg_sleep(1)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "Schema-qualified pg_catalog.pg_sleep is never allowed"
  },
  {
    "id": "functions-003",
    "group": "functions",
    "sql": "SELECT pg_sleep_for('1 second')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_sleep_for process delay is never allowed"
  },
  {
    "id": "functions-004",
    "group": "functions",
    "sql": "SELECT pg_sleep_until(now() + interval '1 second')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_sleep_until process delay is never allowed"
  },
  {
    "id": "functions-005",
    "group": "functions",
    "sql": "SELECT set_config('work_mem', '1GB', false)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "set_config modifies server or session configuration"
  },
  {
    "id": "functions-006",
    "group": "functions",
    "sql": "SELECT pg_catalog.set_config('statement_timeout', '0', false)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_catalog.set_config attempting to disable statement_timeout"
  },
  {
    "id": "functions-007",
    "group": "functions",
    "sql": "SELECT nextval('user_id_seq')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "nextval mutates sequence state"
  },
  {
    "id": "functions-008",
    "group": "functions",
    "sql": "SELECT setval('user_id_seq', 1000)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "setval mutates sequence state"
  },
  {
    "id": "functions-009",
    "group": "functions",
    "sql": "SELECT pg_advisory_lock(1234)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_advisory_lock takes persistent locks across transactions"
  },
  {
    "id": "functions-010",
    "group": "functions",
    "sql": "SELECT pg_try_advisory_lock(1234)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_try_advisory_lock mutates advisory lock state"
  },
  {
    "id": "functions-011",
    "group": "functions",
    "sql": "SELECT pg_notify('channel', 'msg')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_notify triggers asynchronous notifications"
  },
  {
    "id": "functions-012",
    "group": "functions",
    "sql": "SELECT txid_current()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "txid_current assigns a transaction ID to a read-only transaction"
  },
  {
    "id": "functions-013",
    "group": "functions",
    "sql": "SELECT pg_current_xact_id()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_current_xact_id assigns an XID"
  },
  {
    "id": "functions-014",
    "group": "functions",
    "sql": "SELECT pg_terminate_backend(1234)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_terminate_backend terminates database connections"
  },
  {
    "id": "functions-015",
    "group": "functions",
    "sql": "SELECT pg_cancel_backend(1234)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_cancel_backend aborts queries on other backends"
  },
  {
    "id": "functions-016",
    "group": "functions",
    "sql": "SELECT pg_reload_conf()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_reload_conf alters server runtime configuration"
  },
  {
    "id": "functions-017",
    "group": "functions",
    "sql": "SELECT pg_rotate_logfile()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_rotate_logfile forces log rotation on the host"
  },
  {
    "id": "functions-018",
    "group": "functions",
    "sql": "SELECT pg_switch_wal()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_switch_wal alters WAL state"
  },
  {
    "id": "functions-019",
    "group": "functions",
    "sql": "SELECT pg_read_file('postgresql.conf')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_read_file reads host server files"
  },
  {
    "id": "functions-020",
    "group": "functions",
    "sql": "SELECT pg_read_binary_file('server.key')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_read_binary_file reads sensitive host server files"
  },
  {
    "id": "functions-021",
    "group": "functions",
    "sql": "SELECT * FROM pg_ls_dir('.')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_ls_dir directory traversal in FROM clause is forbidden"
  },
  {
    "id": "functions-022",
    "group": "functions",
    "sql": "SELECT pg_ls_logdir()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_ls_logdir inspects server log directories"
  },
  {
    "id": "functions-023",
    "group": "functions",
    "sql": "SELECT pg_ls_waldir()",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_ls_waldir inspects server WAL directories"
  },
  {
    "id": "functions-024",
    "group": "functions",
    "sql": "SELECT pg_stat_file('postgresql.conf')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_stat_file probes host file metadata"
  },
  {
    "id": "functions-025",
    "group": "functions",
    "sql": "SELECT pg_file_write('test.txt', 'data', false)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_file_write writes to host server filesystem"
  },
  {
    "id": "functions-026",
    "group": "functions",
    "sql": "SELECT pg_file_unlink('test.txt')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_file_unlink deletes host server files"
  },
  {
    "id": "functions-027",
    "group": "functions",
    "sql": "SELECT id FROM users WHERE id = (SELECT length(pg_sleep(1)::text))",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_sleep hidden inside a WHERE subquery is refused"
  },
  {
    "id": "functions-028",
    "group": "functions",
    "sql": "SELECT id FROM users ORDER BY pg_sleep(1)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "pg_sleep inside an ORDER BY clause is refused"
  },
  {
    "id": "functions-029",
    "group": "functions",
    "sql": "SELECT abs(-42)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-030",
    "group": "functions",
    "sql": "SELECT sqrt(16), power(2, 8), round(3.14159, 2)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-031",
    "group": "functions",
    "sql": "SELECT lower('HELLO'), upper('world'), length('test')",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-032",
    "group": "functions",
    "sql": "SELECT trim('  hello  '), substr('database', 1, 4)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-033",
    "group": "functions",
    "sql": "SELECT concat('a', 'b', 'c'), concat_ws('-', '2026', '10', '18')",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-034",
    "group": "functions",
    "sql": "SELECT now(), current_date, current_time",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-035",
    "group": "functions",
    "sql": "SELECT date_trunc('year', now()), extract(hour FROM now())",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-036",
    "group": "functions",
    "sql": "SELECT json_build_object('key', 'value'), to_jsonb(123)",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-037",
    "group": "functions",
    "sql": "SELECT array_length(ARRAY[1, 2, 3], 1), cardinality(ARRAY['a', 'b'])",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-038",
    "group": "functions",
    "sql": "SELECT gen_random_uuid()",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-039",
    "group": "functions",
    "sql": "SELECT current_user, version()",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "functions-040",
    "group": "functions",
    "sql": "SELECT current_setting('server_version_num')",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "locking-001",
    "group": "locking",
    "sql": "SELECT id FROM users FOR UPDATE",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR UPDATE row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-002",
    "group": "locking",
    "sql": "SELECT id FROM users FOR NO KEY UPDATE",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR NO KEY UPDATE row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-003",
    "group": "locking",
    "sql": "SELECT id FROM users FOR SHARE",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR SHARE row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-004",
    "group": "locking",
    "sql": "SELECT id FROM users FOR KEY SHARE",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR KEY SHARE row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-005",
    "group": "locking",
    "sql": "SELECT id FROM users FOR UPDATE NOWAIT",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR UPDATE NOWAIT row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-006",
    "group": "locking",
    "sql": "SELECT id FROM users FOR UPDATE SKIP LOCKED",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR UPDATE SKIP LOCKED row locking is forbidden in read-only mode"
  },
  {
    "id": "locking-007",
    "group": "locking",
    "sql": "SELECT id INTO new_users FROM users",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "SELECT INTO table creation is forbidden in read-only mode"
  },
  {
    "id": "locking-008",
    "group": "locking",
    "sql": "SELECT u.id FROM users u FOR UPDATE OF u",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "FOR UPDATE OF table specification is forbidden in read-only mode"
  },
  {
    "id": "locking-009",
    "group": "locking",
    "sql": "SELECT * FROM (SELECT id FROM users FOR UPDATE) sub",
    "expect": {
      "refused": "PGM-202"
    },
    "note": "Row locking inside subquery is forbidden in read-only mode"
  },
  {
    "id": "policy-001",
    "group": "policy",
    "sql": "SELECT * FROM internal_audit",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Direct query to hidden table internal_audit is refused with same message as unknown"
  },
  {
    "id": "policy-002",
    "group": "policy",
    "sql": "SELECT * FROM public.internal_audit",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Schema-qualified query to hidden table internal_audit is refused"
  },
  {
    "id": "policy-003",
    "group": "policy",
    "sql": "SELECT * FROM api_keys",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Direct query to hidden table api_keys is refused"
  },
  {
    "id": "policy-004",
    "group": "policy",
    "sql": "SELECT * FROM public.api_keys",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Schema-qualified query to hidden table api_keys is refused"
  },
  {
    "id": "policy-005",
    "group": "policy",
    "sql": "SELECT * FROM nonexistent_table",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Query to unknown table is refused with PGM-207"
  },
  {
    "id": "policy-006",
    "group": "policy",
    "sql": "SELECT * FROM secret_schema.data",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Query to unexposed schema is refused with PGM-207"
  },
  {
    "id": "policy-007",
    "group": "policy",
    "sql": "SELECT * FROM pg_catalog.pg_class",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Query to pg_catalog is refused when catalog queries are disabled"
  },
  {
    "id": "policy-008",
    "group": "policy",
    "sql": "SELECT * FROM information_schema.tables",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Query to information_schema is refused when catalog queries are disabled"
  },
  {
    "id": "policy-009",
    "group": "policy",
    "sql": "SELECT * FROM pg_class",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Unqualified catalog reference resolves only within exposed schemas and is refused"
  },
  {
    "id": "policy-010",
    "group": "policy",
    "sql": "SELECT u.id, a.id FROM users u JOIN internal_audit a ON u.id = a.user_id",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Hidden table joined in FROM clause is refused"
  },
  {
    "id": "policy-011",
    "group": "policy",
    "sql": "SELECT * FROM users WHERE id IN (SELECT user_id FROM internal_audit)",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Hidden table inside a subquery is refused"
  },
  {
    "id": "policy-012",
    "group": "policy",
    "sql": "WITH a AS (SELECT * FROM internal_audit) SELECT * FROM a",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Hidden table inside a CTE is refused"
  },
  {
    "id": "policy-013",
    "group": "policy",
    "sql": "SELECT 1 UNION ALL SELECT id FROM internal_audit",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Hidden table inside set operation arm is refused"
  },
  {
    "id": "policy-014",
    "group": "policy",
    "sql": "SELECT u.id FROM users u, LATERAL (SELECT * FROM internal_audit WHERE user_id = u.id) a",
    "expect": {
      "refused": "PGM-207"
    },
    "note": "Hidden table inside LATERAL subquery is refused"
  },
  {
    "id": "policy-015",
    "group": "policy",
    "sql": "WITH internal_audit AS (SELECT 1 AS id) SELECT id FROM internal_audit",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-016",
    "group": "policy",
    "sql": "SELECT password_hash FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Unqualified access to hidden column password_hash is refused"
  },
  {
    "id": "policy-017",
    "group": "policy",
    "sql": "SELECT users.password_hash FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Table-qualified access to hidden column users.password_hash is refused"
  },
  {
    "id": "policy-018",
    "group": "policy",
    "sql": "SELECT u.password_hash FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Alias-qualified access to hidden column u.password_hash is refused"
  },
  {
    "id": "policy-019",
    "group": "policy",
    "sql": "SELECT public.users.password_hash FROM public.users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Schema-qualified access to hidden column public.users.password_hash is refused"
  },
  {
    "id": "policy-020",
    "group": "policy",
    "sql": "SELECT mfa_secret FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Access to hidden column mfa_secret is refused"
  },
  {
    "id": "policy-021",
    "group": "policy",
    "sql": "SELECT u.mfa_secret FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Qualified access to hidden column u.mfa_secret is refused"
  },
  {
    "id": "policy-022",
    "group": "policy",
    "sql": "SELECT id FROM users WHERE password_hash = 'hash123'",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column referenced in WHERE clause is refused"
  },
  {
    "id": "policy-023",
    "group": "policy",
    "sql": "SELECT id FROM users ORDER BY password_hash",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column referenced in ORDER BY clause is refused"
  },
  {
    "id": "policy-024",
    "group": "policy",
    "sql": "SELECT count(*) FROM users GROUP BY password_hash",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column referenced in GROUP BY clause is refused"
  },
  {
    "id": "policy-025",
    "group": "policy",
    "sql": "SELECT count(*) FROM users GROUP BY id HAVING count(password_hash) > 0",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column referenced in HAVING clause is refused"
  },
  {
    "id": "policy-026",
    "group": "policy",
    "sql": "SELECT md5(password_hash) FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column passed to function is refused"
  },
  {
    "id": "policy-027",
    "group": "policy",
    "sql": "SELECT CASE WHEN password_hash IS NULL THEN 1 ELSE 0 END FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column inside CASE expression is refused"
  },
  {
    "id": "policy-028",
    "group": "policy",
    "sql": "SELECT id FROM users WHERE coalesce(password_hash, '') = ''",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column inside coalesce expression is refused"
  },
  {
    "id": "policy-029",
    "group": "policy",
    "sql": "SELECT * FROM (SELECT password_hash FROM users) sub",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column inside subquery target list is refused"
  },
  {
    "id": "policy-030",
    "group": "policy",
    "sql": "WITH c AS (SELECT password_hash FROM users) SELECT * FROM c",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Hidden column inside CTE target list is refused"
  },
  {
    "id": "policy-031",
    "group": "policy",
    "sql": "SELECT * FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Wildcard * on table with hidden columns is refused"
  },
  {
    "id": "policy-032",
    "group": "policy",
    "sql": "SELECT u.* FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Qualified wildcard u.* on table with hidden columns is refused"
  },
  {
    "id": "policy-033",
    "group": "policy",
    "sql": "SELECT public.users.* FROM public.users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Schema-qualified wildcard public.users.* on table with hidden columns is refused"
  },
  {
    "id": "policy-034",
    "group": "policy",
    "sql": "SELECT u FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Whole-row reference u on table with hidden columns is refused"
  },
  {
    "id": "policy-035",
    "group": "policy",
    "sql": "SELECT users FROM users",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Whole-row reference without alias on table with hidden columns is refused"
  },
  {
    "id": "policy-036",
    "group": "policy",
    "sql": "SELECT to_jsonb(u) FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Whole-row reference passed to to_jsonb on table with hidden columns is refused"
  },
  {
    "id": "policy-037",
    "group": "policy",
    "sql": "SELECT to_json(u) FROM users u",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Whole-row reference passed to to_json on table with hidden columns is refused"
  },
  {
    "id": "policy-038",
    "group": "policy",
    "sql": "SELECT * FROM users u JOIN orders o ON u.id = o.user_id",
    "expect": {
      "refused": "PGM-208"
    },
    "note": "Unqualified wildcard on join including a table with hidden columns is refused"
  },
  {
    "id": "policy-039",
    "group": "policy",
    "sql": "SELECT * FROM orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-040",
    "group": "policy",
    "sql": "SELECT o.* FROM orders o",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-041",
    "group": "policy",
    "sql": "SELECT public.orders.* FROM public.orders",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-042",
    "group": "policy",
    "sql": "SELECT * FROM tickets",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-043",
    "group": "policy",
    "sql": "SELECT * FROM customers",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-044",
    "group": "policy",
    "sql": "SELECT * FROM events",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-045",
    "group": "policy",
    "sql": "SELECT id, name, email FROM users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-046",
    "group": "policy",
    "sql": "SELECT u.id, u.name, u.email FROM users u",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-047",
    "group": "policy",
    "sql": "SELECT public.users.id, public.users.email FROM public.users",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-048",
    "group": "policy",
    "sql": "SELECT u.id, u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-049",
    "group": "policy",
    "sql": "SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-050",
    "group": "policy",
    "sql": "WITH u AS (SELECT id, name FROM users) SELECT * FROM u",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-051",
    "group": "policy",
    "sql": "SELECT id FROM users WHERE email = 'test@example.com' AND role = 'admin'",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "policy-052",
    "group": "policy",
    "sql": "SELECT id, count(*) FROM orders GROUP BY id ORDER BY id",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "sql-exec-001",
    "group": "sql-exec",
    "sql": "SELECT query_to_xml('select * from internal_audit', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "query_to_xml executes arbitrary dynamic SQL inside the database engine"
  },
  {
    "id": "sql-exec-002",
    "group": "sql-exec",
    "sql": "SELECT pg_catalog.query_to_xml('select * from users', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "Schema-qualified pg_catalog.query_to_xml executing arbitrary SQL"
  },
  {
    "id": "sql-exec-003",
    "group": "sql-exec",
    "sql": "SELECT query_to_xmlschema('select 1', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "query_to_xmlschema executes dynamic SQL to generate schema"
  },
  {
    "id": "sql-exec-004",
    "group": "sql-exec",
    "sql": "SELECT query_to_xml_and_xmlschema('select 1', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "query_to_xml_and_xmlschema executes arbitrary SQL"
  },
  {
    "id": "sql-exec-005",
    "group": "sql-exec",
    "sql": "SELECT cursor_to_xml('my_cursor'::refcursor, 10, true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "cursor_to_xml consumes cursor state dynamically"
  },
  {
    "id": "sql-exec-006",
    "group": "sql-exec",
    "sql": "SELECT cursor_to_xmlschema('my_cursor'::refcursor, true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "cursor_to_xmlschema inspects cursor state dynamically"
  },
  {
    "id": "sql-exec-007",
    "group": "sql-exec",
    "sql": "SELECT table_to_xml('internal_audit'::regclass, true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "table_to_xml dumps arbitrary tables including hidden ones"
  },
  {
    "id": "sql-exec-008",
    "group": "sql-exec",
    "sql": "SELECT table_to_xmlschema('internal_audit'::regclass, true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "table_to_xmlschema dumps schema of tables including hidden ones"
  },
  {
    "id": "sql-exec-009",
    "group": "sql-exec",
    "sql": "SELECT table_to_xml_and_xmlschema('internal_audit'::regclass, true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "table_to_xml_and_xmlschema dumps table data and schema"
  },
  {
    "id": "sql-exec-010",
    "group": "sql-exec",
    "sql": "SELECT schema_to_xml('public', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "schema_to_xml dumps whole database schemas"
  },
  {
    "id": "sql-exec-011",
    "group": "sql-exec",
    "sql": "SELECT schema_to_xmlschema('public', true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "schema_to_xmlschema dumps whole database schemas"
  },
  {
    "id": "sql-exec-012",
    "group": "sql-exec",
    "sql": "SELECT database_to_xml(true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "database_to_xml dumps entire database contents"
  },
  {
    "id": "sql-exec-013",
    "group": "sql-exec",
    "sql": "SELECT database_to_xmlschema(true, false, '')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "database_to_xmlschema dumps entire database schema"
  },
  {
    "id": "sql-exec-014",
    "group": "sql-exec",
    "sql": "SELECT ts_stat('select to_tsvector(name) from users')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "ts_stat executes dynamic SQL query strings"
  },
  {
    "id": "sql-exec-015",
    "group": "sql-exec",
    "sql": "SELECT * FROM dblink('dbname=postgres', 'select * from users') AS t(id int)",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "dblink executes cross-database or out-of-band queries"
  },
  {
    "id": "sql-exec-016",
    "group": "sql-exec",
    "sql": "SELECT dblink_exec('dbname=postgres', 'delete from users')",
    "expect": {
      "refused": "PGM-205"
    },
    "note": "dblink_exec executes writes via remote dblink connection"
  },
  {
    "id": "stacking-001",
    "group": "stacking",
    "sql": "COMMIT; DROP SCHEMA public CASCADE",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking attempting to break out of read-only transaction and drop schema"
  },
  {
    "id": "stacking-002",
    "group": "stacking",
    "sql": "COMMIT; SET statement_timeout TO 1",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking attempting to reset statement_timeout"
  },
  {
    "id": "stacking-003",
    "group": "stacking",
    "sql": "SELECT 1; DELETE FROM users",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking appending DELETE statement after harmless query"
  },
  {
    "id": "stacking-004",
    "group": "stacking",
    "sql": "SELECT 1; SELECT 2",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking with multiple queries is rejected"
  },
  {
    "id": "stacking-005",
    "group": "stacking",
    "sql": "SELECT id FROM users;\nSELECT count(*) FROM orders",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Newline-separated statement stacking is rejected"
  },
  {
    "id": "stacking-006",
    "group": "stacking",
    "sql": "SELECT id FROM users; -- line comment\nDROP TABLE orders",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking after line comment is rejected"
  },
  {
    "id": "stacking-007",
    "group": "stacking",
    "sql": "SELECT id FROM users; /* block comment */ DROP TABLE orders",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking after block comment is rejected"
  },
  {
    "id": "stacking-008",
    "group": "stacking",
    "sql": "/* prefix comment */ SELECT 1; DROP TABLE users",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking with comment prefix is rejected"
  },
  {
    "id": "stacking-009",
    "group": "stacking",
    "sql": "SELECT id FROM users; COMMIT",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking attempting early transaction commit"
  },
  {
    "id": "stacking-0010",
    "group": "stacking",
    "sql": "SELECT id FROM users; ROLLBACK",
    "expect": {
      "refused": "PGM-204"
    },
    "db_blocks": true,
    "note": "Statement stacking attempting early transaction rollback"
  },
  {
    "id": "stacking-0011",
    "group": "stacking",
    "sql": "SELECT ';'",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0012",
    "group": "stacking",
    "sql": "SELECT 'first; second; third' AS val",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0013",
    "group": "stacking",
    "sql": "SELECT $$semicolon; inside; dollar-quotes$$ AS val",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0014",
    "group": "stacking",
    "sql": "SELECT id, name FROM users;",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0015",
    "group": "stacking",
    "sql": "SELECT id, amount FROM orders;   ",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0016",
    "group": "stacking",
    "sql": "SELECT id, name FROM users; -- trailing comment",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "stacking-0017",
    "group": "stacking",
    "sql": "SELECT id, name FROM users; /* trailing block comment */",
    "expect": {
      "allowed": true
    }
  },
  {
    "id": "statements-001",
    "group": "statements",
    "sql": "INSERT INTO users (id, name) VALUES (999, 'evil')",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "INSERT statement is forbidden in read-only mode"
  },
  {
    "id": "statements-002",
    "group": "statements",
    "sql": "UPDATE users SET name = 'pwned' WHERE id = 1",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "UPDATE statement is forbidden in read-only mode"
  },
  {
    "id": "statements-003",
    "group": "statements",
    "sql": "DELETE FROM users WHERE id = 1",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "DELETE statement is forbidden in read-only mode"
  },
  {
    "id": "statements-004",
    "group": "statements",
    "sql": "TRUNCATE TABLE users",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "TRUNCATE statement is forbidden in read-only mode"
  },
  {
    "id": "statements-005",
    "group": "statements",
    "sql": "MERGE INTO users u USING orders o ON u.id = o.user_id WHEN MATCHED THEN DELETE",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "MERGE statement is forbidden in read-only mode"
  },
  {
    "id": "statements-006",
    "group": "statements",
    "sql": "CREATE TABLE evil_table (id int)",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE TABLE DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-007",
    "group": "statements",
    "sql": "CREATE INDEX evil_idx ON users (email)",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE INDEX DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-008",
    "group": "statements",
    "sql": "CREATE VIEW evil_view AS SELECT 1",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE VIEW DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-009",
    "group": "statements",
    "sql": "CREATE SCHEMA evil_schema",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE SCHEMA DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-010",
    "group": "statements",
    "sql": "CREATE ROLE evil_role",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE ROLE DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-011",
    "group": "statements",
    "sql": "CREATE DATABASE evil_db",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE DATABASE DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-012",
    "group": "statements",
    "sql": "CREATE FUNCTION evil_fn() RETURNS void AS 'SELECT 1;' LANGUAGE sql",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CREATE FUNCTION DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-013",
    "group": "statements",
    "sql": "ALTER TABLE users ADD COLUMN evil int",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "ALTER TABLE DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-014",
    "group": "statements",
    "sql": "ALTER ROLE current_user WITH SUPERUSER",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "ALTER ROLE privilege escalation is forbidden in read-only mode"
  },
  {
    "id": "statements-015",
    "group": "statements",
    "sql": "ALTER SCHEMA public RENAME TO secret",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "ALTER SCHEMA DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-016",
    "group": "statements",
    "sql": "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "ALTER DEFAULT PRIVILEGES is forbidden in read-only mode"
  },
  {
    "id": "statements-017",
    "group": "statements",
    "sql": "DROP TABLE users",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "DROP TABLE destructive DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-018",
    "group": "statements",
    "sql": "DROP SCHEMA public CASCADE",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "DROP SCHEMA destructive DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-019",
    "group": "statements",
    "sql": "DROP ROLE postgres",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "DROP ROLE DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-020",
    "group": "statements",
    "sql": "DROP DATABASE postgres",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "DROP DATABASE destructive DDL is forbidden in read-only mode"
  },
  {
    "id": "statements-021",
    "group": "statements",
    "sql": "GRANT ALL PRIVILEGES ON users TO PUBLIC",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "GRANT statement is forbidden in read-only mode"
  },
  {
    "id": "statements-022",
    "group": "statements",
    "sql": "REVOKE ALL PRIVILEGES ON users FROM PUBLIC",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "REVOKE statement is forbidden in read-only mode"
  },
  {
    "id": "statements-023",
    "group": "statements",
    "sql": "BEGIN",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "Manual transaction control BEGIN is forbidden in read-only mode"
  },
  {
    "id": "statements-024",
    "group": "statements",
    "sql": "COMMIT",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "Manual transaction control COMMIT is forbidden in read-only mode"
  },
  {
    "id": "statements-025",
    "group": "statements",
    "sql": "ROLLBACK",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "Manual transaction control ROLLBACK is forbidden in read-only mode"
  },
  {
    "id": "statements-026",
    "group": "statements",
    "sql": "SAVEPOINT sp1",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "SAVEPOINT transaction control is forbidden in read-only mode"
  },
  {
    "id": "statements-027",
    "group": "statements",
    "sql": "SET work_mem = '1GB'",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "SET statement modifying session parameters is forbidden in read-only mode"
  },
  {
    "id": "statements-028",
    "group": "statements",
    "sql": "RESET work_mem",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "RESET statement modifying session parameters is forbidden in read-only mode"
  },
  {
    "id": "statements-029",
    "group": "statements",
    "sql": "DISCARD ALL",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "DISCARD statement clearing session state is forbidden in read-only mode"
  },
  {
    "id": "statements-030",
    "group": "statements",
    "sql": "CHECKPOINT",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "CHECKPOINT administrative statement is forbidden in read-only mode"
  },
  {
    "id": "statements-031",
    "group": "statements",
    "sql": "VACUUM users",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "VACUUM maintenance statement is forbidden in read-only mode"
  },
  {
    "id": "statements-032",
    "group": "statements",
    "sql": "REINDEX TABLE users",
    "expect": {
      "refused": "PGM-201"
    },
    "db_blocks": true,
    "note": "REINDEX maintenance statement is forbidden in read-only mode"
  },
  {
    "id": "statements-033",
    "group": "statements",
    "sql": "LISTEN alert_channel",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "LISTEN statement is forbidden in read-only mode"
  },
  {
    "id": "statements-034",
    "group": "statements",
    "sql": "NOTIFY alert_channel, 'pwned'",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "NOTIFY statement is forbidden in read-only mode"
  },
  {
    "id": "statements-035",
    "group": "statements",
    "sql": "CALL some_procedure()",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "CALL statement executing stored procedures is forbidden in read-only mode"
  },
  {
    "id": "statements-036",
    "group": "statements",
    "sql": "DO $$ BEGIN NULL; END $$",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "DO statement executing arbitrary procedural blocks is forbidden in read-only mode"
  },
  {
    "id": "statements-037",
    "group": "statements",
    "sql": "COPY users TO stdout",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "COPY TO stdout is forbidden in read-only mode"
  },
  {
    "id": "statements-038",
    "group": "statements",
    "sql": "LOCK TABLE users IN ACCESS EXCLUSIVE MODE",
    "expect": {
      "refused": "PGM-201"
    },
    "note": "Explicit table locking is forbidden in read-only mode"
  }
];

import { type PgmoatError, type ErrorCode } from '../errors.js';
import type { PgmoatConfigT } from '../config/schema.js';
import type { ExecResult, RowsResult, JsonValue } from '../types.js';
import { toJsonValue } from '../output/values.js';
import { applyColumnBudget, type ColumnField } from './columns.js';
import { applyCellBudget } from './cells.js';
import { checkPayloadBudget } from './payload.js';

export * from './columns.js';
export * from './cells.js';
export * from './payload.js';

export interface ApplyBudgetsExtras {
  requestId: string;
  offset?: number;
  untrustedColumns?: Set<string> | readonly string[];
  sensitiveColumns?: Set<string> | readonly string[];
}

export type ApplyBudgetsResult =
  | { result: RowsResult; payloadBytes: number }
  | { refused: PgmoatError };

/**
 * Applies query budgets in a fixed, deterministic order:
 * 1. Row limit (drop extra row and collect PGM-301 if rows > max_rows)
 * 2. Column limit (keep first max_columns alphabetically and collect PGM-304)
 * 3. Cell limit (truncate strings > max_cell_chars and collect PGM-307 once with count)
 * 4. Offset warning (collect PGM-306 if offset > offset_warning)
 * 5. Value conversion (JSON-safe scalar/object/array normalization)
 * 6. Payload size check (refuse with PGM-305 if UTF-8 serialized bytes > max_payload_bytes)
 */
export function applyBudgets(
  exec: ExecResult,
  budgets: PgmoatConfigT['budgets'],
  extras: ApplyBudgetsExtras,
): ApplyBudgetsResult {
  const warnings: { code: ErrorCode; message: string }[] = [];

  const untrustedSet = new Set(
    extras.untrustedColumns
      ? Array.from(extras.untrustedColumns)
      : [],
  );
  const sensitiveSet = new Set(
    extras.sensitiveColumns
      ? Array.from(extras.sensitiveColumns)
      : [],
  );

  // 1. Row limit
  let workingRows = [...exec.rows];
  let truncated = exec.truncatedByRowCap;

  if (workingRows.length > budgets.max_rows) {
    workingRows = workingRows.slice(0, budgets.max_rows);
    truncated = true;
  }

  if (truncated) {
    warnings.push({
      code: 'PGM-301',
      message: `Result capped at ${budgets.max_rows} rows.`,
    });
  }

  // 2. Column limit
  type OutputColumn = ColumnField & { untrusted: boolean; masked?: boolean };
  const rawColumns: OutputColumn[] = exec.fields.map((f) => ({
    name: f.name,
    type: f.typeName || 'unknown',
    untrusted: untrustedSet.has(f.name),
    ...(sensitiveSet.has(f.name) ? { masked: true } : {}),
    dataTypeId: f.dataTypeId,
  }));

  const colResult = applyColumnBudget(rawColumns, workingRows, budgets.max_columns);
  const finalColumns = colResult.fields.map((c) => ({
    name: c.name,
    type: c.type,
    untrusted: c.untrusted ?? false,
    ...(c.masked ? { masked: true } : {}),
  }));
  workingRows = colResult.rows;

  if (colResult.truncated) {
    warnings.push({
      code: 'PGM-304',
      message: `Columns truncated to ${budgets.max_columns} (alphabetical).`,
    });
  }

  // 3. Cell limit
  const cellResult = applyCellBudget(workingRows, budgets.max_cell_chars);
  workingRows = cellResult.rows;

  if (cellResult.truncatedCount > 0) {
    const s = cellResult.truncatedCount === 1 ? '' : 's';
    warnings.push({
      code: 'PGM-307',
      message: `Cells shortened to ${budgets.max_cell_chars} characters (${cellResult.truncatedCount} text field${s} shortened).`,
    });
  }

  // 4. Offset warning (from AST, passed in extras)
  if (extras.offset !== undefined && extras.offset > budgets.offset_warning) {
    warnings.push({
      code: 'PGM-306',
      message: `OFFSET ${extras.offset} exceeds recommended threshold of ${budgets.offset_warning}; consider keyset pagination.`,
    });
  }

  // 5. JSON-safe value conversion
  const jsonRows: Record<string, JsonValue>[] = workingRows.map((row) => {
    const jsonRow: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(row)) {
      // eslint-disable-next-line security/detect-object-injection
      jsonRow[k] = toJsonValue(v) as JsonValue;
    }
    return jsonRow;
  });

  const candidate: RowsResult = {
    columns: finalColumns,
    rows: jsonRows,
    row_count: jsonRows.length,
    truncated,
    warnings,
    request_id: extras.requestId,
  };

  // 6. Payload size check
  const { bytes, error } = checkPayloadBudget(candidate, budgets.max_payload_bytes);
  if (error) {
    return { refused: error };
  }

  return {
    result: candidate,
    payloadBytes: bytes,
  };
}

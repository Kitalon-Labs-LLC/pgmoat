export interface ColumnField {
  name: string;
  type: string;
  untrusted?: boolean;
  masked?: boolean;
  dataTypeId?: number;
}

export interface ColumnBudgetResult<T extends ColumnField> {
  fields: T[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  totalColumns: number;
  keptColumns: number;
}

/**
 * Truncates columns to maxColumns keeping the first maxColumns alphabetically.
 */
export function applyColumnBudget<T extends ColumnField>(
  fields: readonly T[],
  rows: readonly Record<string, unknown>[],
  maxColumns: number,
): ColumnBudgetResult<T> {
  const totalColumns = fields.length;

  if (totalColumns <= maxColumns) {
    return {
      fields: [...fields],
      rows: rows.map((r) => ({ ...r })),
      truncated: false,
      totalColumns,
      keptColumns: totalColumns,
    };
  }

  // Sort fields alphabetically by name
  const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
  const keptFields = sorted.slice(0, maxColumns);
  const keptNames = new Set(keptFields.map((f) => f.name));

  const prunedRows = rows.map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const name of keptNames) {
      if (Object.prototype.hasOwnProperty.call(row, name)) {
        // eslint-disable-next-line security/detect-object-injection
        newRow[name] = row[name];
      }
    }
    return newRow;
  });

  return {
    fields: keptFields,
    rows: prunedRows,
    truncated: true,
    totalColumns,
    keptColumns: maxColumns,
  };
}


export interface CellBudgetResult {
  rows: Record<string, unknown>[];
  truncatedCount: number;
}

/**
 * Truncates a string value if it exceeds maxCellChars.
 * Truncated format: slice(0, maxCellChars) + "... [+N chars]"
 */
export function truncateCellString(
  val: string,
  maxCellChars: number,
): { text: string; truncated: boolean } {
  if (val.length <= maxCellChars) {
    return { text: val, truncated: false };
  }
  const extra = val.length - maxCellChars;
  return {
    text: `${val.slice(0, maxCellChars)}... [+${extra} chars]`,
    truncated: true,
  };
}

/**
 * Truncates all string cells in the given rows that exceed maxCellChars.
 */
export function applyCellBudget(
  rows: readonly Record<string, unknown>[],
  maxCellChars: number,
): CellBudgetResult {
  let truncatedCount = 0;

  const prunedRows = rows.map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string') {
        const { text, truncated } = truncateCellString(v, maxCellChars);
        if (truncated) {
          truncatedCount += 1;
        }
        // eslint-disable-next-line security/detect-object-injection
        newRow[k] = text;
      } else {
        // eslint-disable-next-line security/detect-object-injection
        newRow[k] = v;
      }
    }
    return newRow;
  });

  return {
    rows: prunedRows,
    truncatedCount,
  };
}


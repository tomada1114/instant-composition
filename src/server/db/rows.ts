import type { SQLOutputValue } from "node:sqlite";

/** A row as `node:sqlite` returns it. */
export type Row = Record<string, SQLOutputValue>;

/**
 * Reading a column whose type the schema guarantees. A mismatch means the file
 * was written by something else, which is a broken invariant, so it throws.
 */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new TypeError(`Column ${column} is not text.`);
  }
  return value;
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new TypeError(`Column ${column} is not an integer.`);
  }
  return value;
}

export function nullableText(row: Row, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

export function nullableInteger(row: Row, column: string): number | null {
  return row[column] === null ? null : integer(row, column);
}

export function json(row: Row, column: string): unknown {
  return JSON.parse(text(row, column)) as unknown;
}

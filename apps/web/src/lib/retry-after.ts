/** A delta-seconds or HTTP-date hint; unknown formats supply no deadline. */
export function retryAt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  const now = Date.now();
  if (/^\d+$/u.test(text)) {
    return Math.min(Number.MAX_SAFE_INTEGER, now + Number(text) * 1000);
  }
  const date = text.endsWith(" GMT") ? Date.parse(text) : Number.NaN;
  return Number.isFinite(date) ? Math.max(now, date) : undefined;
}

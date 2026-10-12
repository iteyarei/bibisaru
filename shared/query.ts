/** Collapse whitespace and reject empty or very long keywords. */
export function normalizeQuery(raw: string): string | null {
  const query = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(/\s+/g, " ");
  if (query.length < 1 || query.length > 40) return null;
  return query;
}

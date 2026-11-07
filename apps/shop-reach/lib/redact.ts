const REASON_LIMIT = 120;

/** Drop line breaks and any secret value before a reason can leave the server. */
export function publicText(text: string, secrets: readonly string[], limit = REASON_LIMIT): string {
  let out = text.replace(/[\r\n]+/g, " ");
  const needles = secrets.filter((secret) => secret.length >= 8).sort((a, b) => b.length - a.length);
  for (const secret of needles) out = out.split(secret).join("[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > limit ? out.slice(0, limit) : out;
}

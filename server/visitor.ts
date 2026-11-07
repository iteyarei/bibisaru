/** Who this request counts against. The first forwarded address is the visitor when a proxy set it. */
export function visitorKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (forwarded) return forwarded.slice(0, 80);
  const real = request.headers.get("x-real-ip")?.trim() ?? "";
  if (real) return real.slice(0, 80);
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (cloudflare) return cloudflare.slice(0, 80);
  return "cursor";
}

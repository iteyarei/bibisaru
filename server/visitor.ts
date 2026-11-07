const SHARED_VISITOR = "shared";

/**
 * Who this request counts against.
 *
 * The proxy appends the address it actually accepted the connection from.
 * A value the visitor wrote themselves sits further left, so it is ignored.
 * Anything that is not an IP address is ignored too. With no trustworthy
 * address, every such request shares one bucket instead of inventing its own.
 */
export function visitorKey(request: Request): string {
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = ipAddress(hops[index]);
    if (hop) return hop;
  }
  return SHARED_VISITOR;
}

/**
 * Both checks have to pass. A visitor who is already out of their own searches
 * is turned away before the shared ceiling is touched, so their extra clicks
 * do not use up the budget left for everyone else. The shared ceiling still
 * applies when the visitor key changes on every request.
 */
export function withinBudget(
  allowVisitor: (key: string, now: number) => boolean,
  allowAll: (key: string, now: number) => boolean,
  visitor: string,
  now: number,
): boolean {
  if (!allowVisitor(visitor, now)) return false;
  return allowAll("all", now);
}

function ipAddress(value: string): string | null {
  const bare = value.replace(/^\[|\]$/g, "");
  if (isIpv4(bare)) return bare;
  if (isIpv6(bare)) return bare.toLowerCase();
  return null;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv6(value: string): boolean {
  if (!value.includes(":") || value.length > 45) return false;
  if (!/^[0-9a-f:]+$/i.test(value)) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = halves.join(":").split(":").filter(Boolean);
  return groups.length > 0 && groups.length <= 8 && groups.every((group) => group.length <= 4);
}

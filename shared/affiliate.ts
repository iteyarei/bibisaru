/**
 * v1 is the ad-free personal build.
 * Keep this false. A later affiliate build should add parameters in
 * `applyAffiliate` only, and stay able to turn them off by flipping this flag.
 */
export const AFFILIATE_ENABLED = false;

export function applyAffiliate(url: string): string {
  if (!AFFILIATE_ENABLED) return url;
  return url;
}

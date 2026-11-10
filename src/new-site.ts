/** The official 比比猴 site, hosted on Cursor Apps. */
export const NEW_SITE_ORIGIN = "https://bibisaru.apps.grok.bot";

/** Hosts of the old Cloudflare Pages site, including its preview deployments. */
const OLD_SITE_HOST = "bibisaru.pages.dev";

/** True only on the old Cloudflare Pages site (and its *.bibisaru.pages.dev previews). */
export function isOldSiteHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return host === OLD_SITE_HOST || host.endsWith(`.${OLD_SITE_HOST}`);
}

/** Link to the new site, carrying the current search so it opens with the same results. */
export function newSiteUrl(query: string): string {
  const q = query.trim();
  return q ? `${NEW_SITE_ORIGIN}/?q=${encodeURIComponent(q)}` : `${NEW_SITE_ORIGIN}/`;
}

/** Shows the notice on the old host and keeps its link pointed at the current search. */
export function syncNewSiteNotice(root: HTMLElement | null, hostname: string, query: string): void {
  if (!root) return;
  const show = isOldSiteHost(hostname);
  root.hidden = !show;
  if (!show) return;
  const link = root.querySelector<HTMLAnchorElement>("a[data-new-site-link]");
  if (link) link.href = newSiteUrl(query);
}

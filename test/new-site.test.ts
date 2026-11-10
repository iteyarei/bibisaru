import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOldSiteHost, NEW_SITE_ORIGIN, newSiteUrl, syncNewSiteNotice } from "../src/new-site";

describe("old site host", () => {
  it("matches the Cloudflare Pages site and its previews", () => {
    expect(isOldSiteHost("bibisaru.pages.dev")).toBe(true);
    expect(isOldSiteHost("BIBISARU.PAGES.DEV")).toBe(true);
    expect(isOldSiteHost("bibisaru.pages.dev.")).toBe(true);
    expect(isOldSiteHost("3d2dd3f.bibisaru.pages.dev")).toBe(true);
    expect(isOldSiteHost("fix-branch.bibisaru.pages.dev")).toBe(true);
  });

  it("does not match the new site, local dev or look-alikes", () => {
    expect(isOldSiteHost("bibisaru.apps.grok.bot")).toBe(false);
    expect(isOldSiteHost("localhost")).toBe(false);
    expect(isOldSiteHost("127.0.0.1")).toBe(false);
    expect(isOldSiteHost("notbibisaru.pages.dev")).toBe(false);
    expect(isOldSiteHost("bibisaru.pages.dev.evil.com")).toBe(false);
    expect(isOldSiteHost("bibisaru-apps-grok-4zdje77be.vercel.app")).toBe(false);
  });
});

describe("new site link", () => {
  it("points at the official host", () => {
    expect(NEW_SITE_ORIGIN).toBe("https://bibisaru.apps.grok.bot");
    expect(newSiteUrl("")).toBe("https://bibisaru.apps.grok.bot/");
    expect(newSiteUrl("  ")).toBe("https://bibisaru.apps.grok.bot/");
  });

  it("carries the current keyword", () => {
    expect(newSiteUrl("藍芽 耳機")).toBe(
      `https://bibisaru.apps.grok.bot/?q=${encodeURIComponent("藍芽 耳機")}`,
    );
    expect(newSiteUrl("a&b")).toBe("https://bibisaru.apps.grok.bot/?q=a%26b");
  });
});

describe("syncNewSiteNotice", () => {
  function fakeNotice() {
    const link = { href: "https://bibisaru.apps.grok.bot/" };
    const classes = new Set<string>();
    const classList = { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) };
    const root = {
      hidden: true,
      ownerDocument: { documentElement: { classList } },
      querySelector: (selector: string) => (selector === "a[data-new-site-link]" ? link : null),
    };
    return { root: root as unknown as HTMLElement, link, state: root, classes };
  }

  it("shows the notice on the old host with the keyword in the link", () => {
    const notice = fakeNotice();
    syncNewSiteNotice(notice.root, "bibisaru.pages.dev", "電鍋");
    expect(notice.state.hidden).toBe(false);
    expect(notice.link.href).toBe(`https://bibisaru.apps.grok.bot/?q=${encodeURIComponent("電鍋")}`);
    expect(notice.classes.has("old-site")).toBe(true);
  });

  it("keeps it hidden on the new host", () => {
    const notice = fakeNotice();
    notice.state.hidden = false;
    syncNewSiteNotice(notice.root, "bibisaru.apps.grok.bot", "電鍋");
    expect(notice.state.hidden).toBe(true);
    expect(notice.classes.has("old-site")).toBe(false);
    expect(notice.link.href).toBe("https://bibisaru.apps.grok.bot/");
  });

  it("does nothing without the element", () => {
    expect(() => syncNewSiteNotice(null, "bibisaru.pages.dev", "")).not.toThrow();
  });
});

describe("homepage notice markup", () => {
  const html = readFileSync("index.html", "utf8");

  it("is hidden by default and sits right under the search box", () => {
    const aside = html.match(/<aside class="new-site" id="new-site"[^>]*>/)?.[0] ?? "";
    expect(aside).toContain("hidden");
    expect(html.indexOf('id="new-site"')).toBeGreaterThan(html.indexOf('class="search-hint"'));
    expect(html.indexOf('id="new-site"')).toBeLessThan(html.indexOf('id="exclude"'));
    expect(html).toContain('class="intro-body"');
  });

  it("names a platform only the new site can list and links there", () => {
    expect(html).toContain("比比猴新站上線囉！");
    expect(html).toContain("酷澎");
    expect(html).toContain("也可以到新站使用喔！");
    expect(html).toMatch(/<a class="new-site-go" data-new-site-link href="https:\/\/bibisaru\.apps\.grok\.bot\/">/);
  });
});

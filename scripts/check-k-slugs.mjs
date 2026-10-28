#!/usr/bin/env node
/**
 * Build gate for the landing pages.
 *
 * Runs before `npm run build`:
 *   - every hot keyword must have its own fixed slug, so a weekly keyword
 *     added without one stops the deploy instead of quietly vanishing;
 *   - a slug must never change, so this only ever checks for gaps;
 *   - a stored snapshot must point at a slug that still exists, and carry a
 *     real YYYY/MM/DD date, so a retired page never renders with a broken date.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(root, "shared", name), "utf8"));
const keywords = read("hot-keywords.json");
const slugs = read("k-slugs.json");
const snapshots = read("k-snapshots.json");

const PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const problems = [];
const used = new Map();

for (const [keyword, slug] of Object.entries(slugs)) {
  if (typeof slug !== "string" || !PATTERN.test(slug)) problems.push(`slug is not url-safe: ${keyword} → ${slug}`);
  if (used.has(slug)) problems.push(`duplicate slug ${slug}: ${used.get(slug)} and ${keyword}`);
  used.set(slug, keyword);
}
for (const item of keywords) {
  if (!slugs[item.keyword]) problems.push(`hot keyword has no slug: ${item.keyword}`);
}
for (const [slug, snapshot] of Object.entries(snapshots)) {
  if (!used.has(slug)) problems.push(`snapshot for unknown slug: ${slug}`);
  if (!snapshot || typeof snapshot !== "object") {
    problems.push(`snapshot ${slug} is not an object`);
    continue;
  }
  if (typeof snapshot.date !== "string" || !/^\d{4}\/\d{2}\/\d{2}$/.test(snapshot.date)) {
    problems.push(`snapshot ${slug} needs a YYYY/MM/DD date`);
  }
  if (!Array.isArray(snapshot.products)) problems.push(`snapshot ${slug} needs a products array`);
}
if (problems.length) {
  console.error("k-slugs check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nAdd the missing entry to shared/k-slugs.json. A slug must never change once published,`);
  console.error(`and a retired keyword keeps its entry here so its page lives on.`);
  process.exit(1);
}
const retired = Object.keys(slugs).filter((keyword) => !keywords.some((item) => item.keyword === keyword));
console.log(
  `k-slugs ok: ${keywords.length} hot keywords, ${Object.keys(slugs).length} slugs (${retired.length} kept after retirement), ` +
    `${Object.keys(snapshots).length} stored snapshots.`,
);

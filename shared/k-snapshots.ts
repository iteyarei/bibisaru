import raw from "./k-snapshots.json";
import type { Product } from "./types";

/**
 * The last prices a keyword page was generated with.
 *
 * A keyword that drops off the hot list is never deleted: its slug stays in
 * `k-slugs.json`, so its page keeps answering at the same URL. It just stops
 * being regenerated, and the page then shows the snapshot below — with the
 * date the snapshot was taken — instead of pretending today's price.
 *
 * Whoever retires a keyword pastes its last result set here (or lets the
 * weekly job do it); `product` entries use the same shape as /api/search.
 */
export interface KSnapshot {
  /** YYYY/MM/DD, the day the prices below were captured. */
  date: string;
  /** Kept so the retired page still shows the right category in its copy. */
  category?: string;
  products: readonly Product[];
}

const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.platform === "string" &&
    typeof item.title === "string" &&
    item.title.trim() !== "" &&
    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
    item.price > 0 &&
    typeof item.url === "string" &&
    typeof item.image === "string" &&
    typeof item.rank === "number"
  );
}

/** Validate the file so a typo fails the build instead of blanking a page. */
export function validateSnapshots(input: unknown): Record<string, KSnapshot> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("k-snapshots must be an object");
  const out: Record<string, KSnapshot> = {};
  for (const [slug, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") throw new Error(`snapshot ${slug} is not an object`);
    const { date, category, products } = value as Record<string, unknown>;
    if (typeof date !== "string" || !DATE_PATTERN.test(date)) throw new Error(`snapshot ${slug} needs a YYYY/MM/DD date`);
    if (category !== undefined && (typeof category !== "string" || !category.trim())) {
      throw new Error(`snapshot ${slug} category must be a non-empty string`);
    }
    if (!Array.isArray(products) || !products.every(isProduct)) throw new Error(`snapshot ${slug} has an invalid product`);
    out[slug] = category ? { date, category, products: products as Product[] } : { date, products: products as Product[] };
  }
  return out;
}

export const K_SNAPSHOTS: Readonly<Record<string, KSnapshot>> = validateSnapshots(raw);

/** The stored snapshot for a slug, or null while the page is still live. */
export function snapshotForSlug(
  slug: string,
  snapshots: Readonly<Record<string, KSnapshot>> = K_SNAPSHOTS,
): KSnapshot | null {
  return snapshots[slug.trim().toLowerCase()] ?? null;
}

/**
 * Parse a snapshot date back into a Date for the copy helpers.
 *
 * Noon in Taipei, not midnight: noon is ten hours away from both neighbouring
 * dates, so no formatter, locale or rounding can ever land on the wrong day.
 */
export function snapshotDate(snapshot: KSnapshot): Date {
  const [year, month, day] = snapshot.date.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 4));
}

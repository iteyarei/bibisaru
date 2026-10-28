import { PLATFORM_IDS } from "./platforms";
import { searchTokens, tokenForms } from "./synonyms";
import { normalizeMatchText } from "./text";
import type { PlatformId, Product } from "./types";

/**
 * Choosing what a /k/ landing page shows.
 *
 * The shops answer a keyword with a mixed bag: a bookstore finds a title with
 * 「除濕」 in it, a marketplace pads its list with last year's accessories.
 * Taking the cheapest N of that pile produced pages that were cheap and wrong.
 * So a listing has to earn its place: its title must carry the keyword, and
 * then the platforms take turns so one shop cannot fill the whole page.
 */

/** How many listings a landing page shows. */
export const K_PICK_LIMIT = 20;

/**
 * Shops that sell books. A book called 「除濕機維修手冊」 is not a dehumidifier,
 * so appliance and gadget pages leave these shops out entirely.
 */
export const BOOKSTORE_PLATFORMS: readonly PlatformId[] = ["kingstone", "sanmin"];

const BOOKSTORE_BLOCKED_CATEGORIES = new Set(["家電", "3C"].map((value) => normalizeMatchText(value)));

/** True for the categories where a bookstore result is always the wrong kind of thing. */
export function bookstoresExcluded(category: string): boolean {
  return BOOKSTORE_BLOCKED_CATEGORIES.has(normalizeMatchText(category ?? "").trim());
}

/** The shops to drop for a category. Empty means every shop may answer. */
export function excludedForCategory(category: string): PlatformId[] {
  return bookstoresExcluded(category) ? [...BOOKSTORE_PLATFORMS] : [];
}

/** One search term and every spelling it may appear under (synonym rows included). */
export interface MatchToken {
  token: string;
  /** Compact forms: letters and digits only, case and width folded. */
  forms: readonly string[];
}

export interface MatchPlan {
  /** The whole query, compacted. A title containing it is the strongest match. */
  phrase: string;
  tokens: readonly MatchToken[];
}

/** Letters and digits only, so 「Switch 2」, 「switch2」 and 「ＳＷＩＴＣＨ-２」 all agree. */
export function compactText(value: string): string {
  return normalizeMatchText(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Split a keyword into the terms a title has to carry, one form set per term. */
export function matchPlan(query: string): MatchPlan {
  const tokens = searchTokens(query ?? "").map((token) => {
    const forms = [...new Set(tokenForms(token).map(compactText).filter(Boolean))];
    return { token, forms };
  });
  return { phrase: compactText(query ?? ""), tokens };
}

/** 0: the whole query sits in the title. 1: every term is there. 2: not a match. */
export function matchRank(title: string, plan: MatchPlan): number {
  if (!plan.tokens.length) return 2;
  const hay = compactText(title ?? "");
  if (!hay) return 2;
  const everyTerm = plan.tokens.every((token) => token.forms.some((form) => hay.includes(form)));
  if (!everyTerm) return 2;
  return plan.phrase && hay.includes(plan.phrase) ? 0 : 1;
}

/**
 * How well a title answers the query, lowest first.
 * «iPhone 18 Pro» is three terms, so an iPhone 14 case fails on `18`.
 */
export function relevanceRank(title: string, query: string): number {
  return matchRank(title, matchPlan(query));
}

/** Every term has to appear, in any order, under any of its names. */
export function isRelevantTitle(title: string, plan: MatchPlan): boolean {
  return matchRank(title, plan) < 2;
}

export interface PickOptions {
  keyword: string;
  /** How many listings the page wants. Fewer are returned when there are fewer matches. */
  limit?: number;
  /** Shops that may not appear at all, such as bookstores on an appliance page. */
  excludePlatforms?: readonly PlatformId[];
  /** Round-robin order. Shops left out of it keep taking turns after the listed ones. */
  platformOrder?: readonly PlatformId[];
}

interface Candidate {
  product: Product;
  rank: number;
  /** Position in the shop's own result list. */
  order: number;
  /** Position in the answer as it arrived, the last tie-break. */
  seq: number;
}

function usable(product: Product): boolean {
  return (
    Number.isFinite(product.price) &&
    product.price > 0 &&
    typeof product.title === "string" &&
    product.title.trim() !== ""
  );
}

function cheapestFirst(a: Candidate, b: Candidate): number {
  return a.rank - b.rank || a.product.price - b.product.price || a.order - b.order;
}

function pageOrder(a: Candidate, b: Candidate): number {
  return a.product.price - b.product.price || a.rank - b.rank || a.order - b.order || a.seq - b.seq;
}

/**
 * The listings a landing page should show.
 *
 * Relevant listings are grouped by shop and sorted there (best match first,
 * then cheapest). The shops then take turns, one listing each, so a single
 * shop with a hundred cheap rows cannot crowd out the rest. The winner set is
 * finally sorted by price, because the page promises a cheapest-first list.
 */
export function pickKProducts(products: readonly Product[], options: PickOptions): Product[] {
  const limit = Math.max(0, Math.trunc(options.limit ?? K_PICK_LIMIT));
  if (!limit) return [];
  const plan = matchPlan(options.keyword);
  if (!plan.tokens.length) return [];
  const excluded = new Set(options.excludePlatforms ?? []);

  const queues = new Map<PlatformId, Candidate[]>();
  // One shop sometimes sends the same row twice (same title, same price, two
  // links). Printing it twice makes the page look padded, so only the first stays.
  const seen = new Set<string>();
  for (const [seq, product] of products.entries()) {
    if (!usable(product) || excluded.has(product.platform)) continue;
    const rank = matchRank(product.title, plan);
    if (rank > 1) continue;
    const fingerprint = `${product.platform}\u0000${compactText(product.title)}\u0000${product.price}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const queue = queues.get(product.platform);
    const candidate: Candidate = { product, rank, order: product.rank, seq };
    if (queue) queue.push(candidate);
    else queues.set(product.platform, [candidate]);
  }
  if (!queues.size) return [];
  for (const queue of queues.values()) queue.sort(cheapestFirst);

  // Requested order first, then any shop the caller forgot, so nothing is lost.
  const order: PlatformId[] = [...(options.platformOrder ?? PLATFORM_IDS)];
  for (const id of PLATFORM_IDS) if (!order.includes(id)) order.push(id);

  const picked: Candidate[] = [];
  const cursor = new Map<PlatformId, number>();
  // Strong matches fill the page first. A weaker match (every term present, but
  // the whole phrase missing) only steps in when the strong ones run out, so a
  // shop with a couple of exact hits cannot be padded with look-alikes.
  for (let tier = 0; tier <= 1 && picked.length < limit; tier += 1) {
    let moved = true;
    while (picked.length < limit && moved) {
      moved = false;
      for (const id of order) {
        if (picked.length >= limit) break;
        const queue = queues.get(id);
        if (!queue) continue;
        // Skipping over a weaker row must not consume it: the shop may still
        // answer in the next tier. Only a row that is actually taken moves the
        // cursor, otherwise a weaker match could be walked past and lost.
        let at = cursor.get(id) ?? 0;
        while (at < queue.length && queue[at].rank > tier) at += 1;
        if (at >= queue.length) continue;
        picked.push(queue[at]);
        cursor.set(id, at + 1);
        moved = true;
      }
    }
  }

  return picked.sort(pageOrder).map((candidate) => candidate.product);
}

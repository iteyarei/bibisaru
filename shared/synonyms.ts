import { segmentCjkKeyword } from "./segment";
import { normalizeMatchText } from "./text";

/**
 * Interchangeable product names. Add a row to extend.
 * Matching ignores case and full-width characters. Multi-word rows stay one term
 * even though the search box splits on spaces.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["NS2", "Switch 2", "Switch2", "任天堂 Switch 2"],
  ["NS", "Switch"],
  ["PS5", "PlayStation 5"],
];

function norm(value: string): string {
  return normalizeMatchText(value).replace(/\s+/g, " ").trim();
}

/** Letters and digits only, so "fold8" matches "Fold 8" and "512GB" matches "512 GB". */
function compact(value: string): string {
  return norm(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

const GROUP_KEYS: readonly { forms: readonly string[] }[] = SYNONYM_GROUPS.map((group) => ({
  forms: [...new Set(group.map(norm).filter(Boolean))],
}));

/**
 * A category word may also be sold under another name. Searching the category
 * keeps those titles. Searching one of the other names does not open the
 * whole category, and a two-character word that is not listed here still has
 * to appear itself.
 */
const CATEGORY_TITLES: Readonly<Record<string, readonly string[]>> = {
  餅乾: ["方塊酥", "蘇打餅"],
  // Names that often ship with no 「麵」 in the title. A title that does say 麵 is handled below.
  泡麵: ["辛拉麵", "來一客", "一度贊", "一度讚", "漢寶", "indomie", "營多麵", "真爽", "味味A", "滿漢大餐"],
};

/** 「麵」 here is a different food, so a 泡麵 search leaves it out. */
const NOT_INSTANT_NOODLE = ["麵包", "麵粉", "麵條", "麵線", "義大利麵", "義式麵", "通心麵", "通心粉", "烏龍麵", "涼麵", "蕎麥麵"];

function groupForms(phrase: string): readonly string[] | null {
  const key = norm(phrase);
  return GROUP_KEYS.find((group) => group.forms.includes(key))?.forms ?? null;
}

/** Split a query into terms. A listed multi-word synonym stays one term. */
export function searchTokens(query: string): string[] {
  const words = norm(query).split(" ").filter(Boolean);
  const maxWords = GROUP_KEYS.reduce((max, group) => {
    const wordsInGroup = group.forms.reduce((longest, form) => Math.max(longest, form.split(" ").length), 1);
    return Math.max(max, wordsInGroup);
  }, 1);
  const tokens: string[] = [];
  let index = 0;
  while (index < words.length) {
    let taken = 1;
    const room = Math.min(maxWords, words.length - index);
    for (let size = room; size > 1; size -= 1) {
      const phrase = words.slice(index, index + size).join(" ");
      if (groupForms(phrase)) {
        taken = size;
        break;
      }
    }
    tokens.push(words.slice(index, index + taken).join(" "));
    index += taken;
  }
  return tokens;
}

/** The term itself, plus every name in its synonym row when it has one. */
export function tokenForms(token: string): string[] {
  const forms = groupForms(token);
  return forms ? [...forms] : [norm(token)].filter(Boolean);
}

function formInTitle(title: string, compactTitle: string, form: string): boolean {
  const folded = compact(form);
  if (folded) return compactTitle.includes(folded);
  const plain = norm(form);
  return plain.length > 0 && norm(title).includes(plain);
}

/** A space-free CJK keyword longer than two characters can be split. Latin and short words stay whole. */
function isSegmentableCjk(form: string): boolean {
  const plain = norm(form);
  if (!plain || plain.includes(" ")) return false;
  const folded = compact(form);
  return folded.length > 2 && /^\p{Script=Han}+$/u.test(folded);
}

function segmentedFormInTitle(compactTitle: string, form: string): boolean {
  if (!isSegmentableCjk(form)) return false;
  const segments = segmentCjkKeyword(compact(form));
  if (segments.length < 2) return false;
  return segments.every((segment) => segment.length > 0 && compactTitle.includes(segment));
}

export type TokenMatch = "exact" | "segment" | "category" | "none";

function listedCategoryTitle(compactTitle: string, token: string): boolean {
  const aliases = CATEGORY_TITLES[compact(token)];
  if (!aliases) return false;
  return aliases.some((alias) => {
    const folded = compact(alias);
    return folded.length > 0 && compactTitle.includes(folded);
  });
}

/**
 * 泡麵 is sold under many names. A pack whose title contains 麵 stays
 * (真爽、炸醬麵、湯麵). Bread, flour, and pasta do not. A listed name with
 * no 麵, such as 來一客 or 漢寶, stays too.
 */
function categoryTitle(compactTitle: string, token: string): boolean {
  if (listedCategoryTitle(compactTitle, token)) return true;
  if (compact(token) !== "泡麵") return false;
  if (NOT_INSTANT_NOODLE.some((word) => compactTitle.includes(compact(word)))) return false;
  return compactTitle.includes("麵");
}

/**
 * Exact means some synonym form sits in the title as one contiguous string.
 * Segment is the fallback for a long CJK keyword: every piece must appear, in any order.
 * Category is a listed other name for that search word, and it ranks below both.
 */
export function tokenMatchKind(title: string, token: string): TokenMatch {
  const compactTitle = compact(title);
  const forms = tokenForms(token);
  if (forms.some((form) => formInTitle(title, compactTitle, form))) return "exact";
  if (forms.some((form) => segmentedFormInTitle(compactTitle, form))) return "segment";
  if (categoryTitle(compactTitle, token)) return "category";
  return "none";
}

export function titleHasEveryTerm(title: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  return tokens.every((token) => tokenMatchKind(title, token) !== "none");
}

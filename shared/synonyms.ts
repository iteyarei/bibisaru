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

const GROUP_KEYS: readonly { forms: readonly string[] }[] = SYNONYM_GROUPS.map((group) => ({
  forms: [...new Set(group.map(norm).filter(Boolean))],
}));

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

export function titleHasEveryTerm(title: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = norm(title);
  return tokens.every((token) => tokenForms(token).some((form) => haystack.includes(form)));
}

/** Shopping-title noise. Longer phrases must come first. */
const AD_PHRASES = [
  "免運費",
  "快速出貨",
  "當日出貨",
  "福利品",
  "公司貨",
  "免運",
  "運費",
  "現貨",
  "獨家",
  "原廠",
  "正品",
  "下殺",
  "限時",
  "促銷",
  "特價",
  "熱銷",
  "新品",
  "全新",
  "保固",
  "贈品",
  "註冊",
] as const;

const BRACKETS =
  /【([^】]*)】|［([^］]*)］|\[([^\]]*)\]|《([^》]*)》|〈([^〉]*)〉|（([^）]*)）|\(([^)]*)\)/g;

function stripAds(value: string): string {
  let next = value;
  for (const phrase of AD_PHRASES) next = next.replaceAll(phrase, " ");
  return next;
}

function isGrade(token: string): boolean {
  return /^[A-Za-z]?\+?級$/.test(token);
}

/** A model code mixes letters and digits, like 210811BBK or Fold8. Plain sizes such as 512GB are not models. */
function isModel(token: string): boolean {
  const core = token.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
  if (core.length < 4 || core.length > 24) return false;
  if (!/\p{L}/u.test(core) || !/\d/.test(core)) return false;
  return !/^\d+(?:gb|g|tb|mb|mm|cm)$/i.test(core);
}

function modelRange(tokens: readonly string[]): { start: number; end: number } | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (isModel(token)) return { start: index, end: index };
    const next = tokens[index + 1];
    if (next && /^[\p{L}]{2,12}$/u.test(token) && /^\d{1,4}$/.test(next)) return { start: index, end: index + 1 };
  }
  return null;
}

function unwrapBracket(inner: string): string {
  const cleaned = stripAds(inner)
    .replace(/[^\p{L}\p{N}+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return " ";
  const tokens = cleaned.split(" ").filter((token) => token && !isGrade(token));
  if (!tokens.length) return " ";
  if (tokens.some((token) => isModel(token))) return ` ${tokens.join(" ")} `;
  if (tokens.every((token) => !/\d/.test(token)) && tokens.join(" ").length <= 16) return ` ${tokens.join(" ")} `;
  return " ";
}

function cleanTitle(title: string): string[] {
  const unwrapped = stripAds(title).replace(BRACKETS, (_match, ...groups: string[]) => {
    const inner = groups.find((group) => group !== undefined) ?? "";
    return unwrapBracket(inner);
  });
  return unwrapped
    .replace(/[^\p{L}\p{N}+-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !isGrade(token) && !AD_PHRASES.some((phrase) => phrase === token));
}

function fit(tokens: readonly string[]): string {
  let chosen = [...tokens];
  while (chosen.length > 1 && chosen.join(" ").length > 40) chosen = chosen.slice(1);
  let text = chosen.join(" ");
  if (text.length > 40) text = text.slice(0, 40).trim();
  return text.trim();
}

/**
 * A short query for "search this product" across shops.
 * Full titles fail the all-words match, so this keeps a brand plus a model code
 * (Skechers 210811BBK) or, when there is no code, the first few words.
 */
export function similarQuery(title: string): string {
  const tokens = cleanTitle(title);
  const range = modelRange(tokens);
  if (!range) return fit(tokens.slice(0, 3));

  const hasLatin = tokens.some((token) => /\p{Script=Latin}/u.test(token));
  const before: string[] = [];
  for (let index = range.start - 1; index >= 0 && before.length < 3; index -= 1) {
    const token = tokens[index] ?? "";
    if (hasLatin && /^[\u3400-\u9fff]{1,2}$/.test(token)) continue;
    before.unshift(token);
  }
  const query = fit([...before, ...tokens.slice(range.start, range.end + 1)]);
  return query || fit(tokens.slice(0, 3));
}

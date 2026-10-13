/**
 * Brands and common product words. Add a string to extend.
 * Longer words are tried first, so 電子鍋 wins over 電鍋.
 */
export const CJK_TERMS: readonly string[] = [
  "空氣清淨機",
  "國際牌",
  "洗衣機",
  "吹風機",
  "熱水瓶",
  "壓力鍋",
  "電子鍋",
  "除濕機",
  "吸塵器",
  "電風扇",
  "電暖器",
  "開飲機",
  "洗碗機",
  "烘衣機",
  "微波爐",
  "咖啡機",
  "果汁機",
  "調理機",
  "不鏽鋼",
  "飛利浦",
  "電鍋",
  "冰箱",
  "烤箱",
  "冷氣",
  "電視",
  "手機",
  "筆電",
  "耳機",
  "相機",
  "大同",
  "象印",
  "虎牌",
  "聲寶",
  "日立",
  "東元",
  "三洋",
  "奇美",
  "禾聯",
  "夏普",
  "松下",
  "三菱",
  "東芝",
  "美的",
  "格力",
  "海爾",
  "小米",
  "戴森",
];

const TERMS = [...new Set(CJK_TERMS.filter((word) => word.length >= 2))].sort((a, b) => b.length - a.length);

let segmenterCache: Intl.Segmenter | null | undefined;

function wordSegmenter(): Intl.Segmenter | null {
  if (segmenterCache !== undefined) return segmenterCache;
  if (typeof Intl.Segmenter !== "function") {
    segmenterCache = null;
    return null;
  }
  try {
    segmenterCache = new Intl.Segmenter("zh", { granularity: "word" });
  } catch {
    segmenterCache = null;
  }
  return segmenterCache;
}

function longestTermAt(text: string, index: number): string | null {
  for (const word of TERMS) {
    if (text.startsWith(word, index)) return word;
  }
  return null;
}

/** Segmenter words only when every piece is at least two characters and they rebuild the span. */
function segmenterParts(span: string): string[] | null {
  const segmenter = wordSegmenter();
  if (!segmenter) return null;
  const parts: string[] = [];
  for (const item of segmenter.segment(span)) {
    if (!item.segment) continue;
    parts.push(item.segment);
  }
  if (parts.length < 2) return null;
  if (parts.some((part) => part.length < 2)) return null;
  if (parts.join("") !== span) return null;
  return parts;
}

/** Non-overlapping pairs. An odd tail overlaps the previous pair so no one-character piece remains. */
function bigrams(span: string): string[] {
  if (span.length <= 2) return span ? [span] : [];
  const parts: string[] = [];
  const last = span.length % 2 === 0 ? span.length : span.length - 1;
  for (let index = 0; index < last; index += 2) parts.push(span.slice(index, index + 2));
  if (span.length % 2 !== 0) parts.push(span.slice(-2));
  return parts;
}

function segmentUnmatched(span: string): string[] {
  return segmenterParts(span) ?? bigrams(span);
}

/**
 * Split a CJK keyword into pieces.
 * Known words are taken left to right, longest first.
 * Gaps use Intl.Segmenter when it returns a real split, otherwise two-character bigrams.
 */
export function segmentCjkKeyword(text: string): string[] {
  const parts: string[] = [];
  let index = 0;
  while (index < text.length) {
    const hit = longestTermAt(text, index);
    if (hit) {
      parts.push(hit);
      index += hit.length;
      continue;
    }
    let end = index + 1;
    while (end < text.length && !longestTermAt(text, end)) end += 1;
    parts.push(...segmentUnmatched(text.slice(index, end)));
    index = end;
  }
  return parts;
}

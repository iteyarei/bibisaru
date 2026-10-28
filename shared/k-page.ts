import { applyAffiliate } from "./affiliate";
import { escapeHtml, safeUrl, scriptJson } from "./html";
import { groupHotKeywords, HOT_KEYWORDS, type HotKeyword } from "./hot-keywords";
import {
  kOverviewUrl,
  kPagePath,
  kPageUrl,
  KEYWORD_SLUGS,
  SITE_ORIGIN,
  slugForKeyword,
} from "./k-slugs";
import { matchPlan } from "./k-pick";
import { PLATFORM_IDS, PLATFORMS, platformById } from "./platforms";
import type { PlatformReport, Product } from "./types";

/** How many listings a landing page shows. Enough to be useful, small enough to stay fast. */
export const K_PAGE_ITEMS = 20;

const MAX_META_PLATFORMS = 3;

const OUTBOUND_REL = "noopener nofollow sponsored";

export const K_PAGE_CSS = `
:root{--teal:#13b7a2;--teal-dark:#0e9a88;--bg:#e8f7f5;--card:#fff;--ink:#1a2e2b;--muted:#5c706c;--line:#c9e3de}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;font-size:16px;line-height:1.6}
header{background:var(--teal);border-bottom:1px solid var(--teal-dark)}
header .inner,main,footer .inner{max-width:760px;margin:0 auto;padding:0 16px}
header .inner{display:flex;align-items:center;gap:10px;min-height:56px}
header a{color:#fff;text-decoration:none;font-weight:700;font-size:19px}
main{padding:20px 16px 40px}
nav.crumbs{font-size:13px;color:var(--muted);margin:0 0 12px}
nav.crumbs a{color:var(--muted)}
h1{font-size:23px;line-height:1.35;margin:0 0 10px}
.why{margin:0 0 8px;font-size:13px;color:var(--muted)}
.lead{margin:0 0 8px}
.lead b{color:var(--teal-dark)}
.cta{display:inline-block;background:var(--teal);color:#fff;text-decoration:none;font-weight:800;font-size:17px;padding:13px 24px;border-radius:999px;margin:8px 0 12px;box-shadow:0 2px 0 #0b8a7b}
.cta:active{transform:translateY(1px);box-shadow:none}
.cta:hover,.cta:focus-visible{background:var(--teal-dark)}
.stamp{font-size:13px;color:var(--muted);margin:0 0 16px}
.stamp.idle{color:#a1601f}
ul.list.loading{opacity:.45;transition:opacity .15s}
ul.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
ul.list li{background:var(--card);border:1px solid var(--line);border-radius:14px}
ul.list a{display:flex;gap:12px;padding:12px;color:inherit;text-decoration:none;align-items:center}
ul.list a:hover,ul.list a:focus-visible{border-color:var(--teal)}
.thumb{width:76px;height:76px;min-width:76px;border-radius:10px;background:#f1f7f6;object-fit:contain}
.info{min-width:0;flex:1}
.name{font-size:14px;line-height:1.45;margin:0 0 6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.p{font-weight:800;color:var(--teal-dark);font-size:17px}
.best{background:#ecfdf5;color:#047857;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px}
.tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.empty{margin:16px 0;padding:14px 16px;background:var(--card);border:1px dashed var(--line);border-radius:12px}
.more{margin:22px 0 0;font-size:14px}
.more a{color:var(--teal-dark)}
footer{background:#fff;border-top:1px solid var(--line);padding:18px 0;font-size:13px;color:var(--muted)}
footer p{margin:0 0 6px}
@media (max-width:420px){h1{font-size:20px}.thumb{width:64px;height:64px;min-width:64px}}
`;

function formatTwd(amount: number): string {
  return `NT$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** YYYY/MM/DD in Taipei time, the date the copy puts in front of the reader. */
export function taipeiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts.replace(/-/g, "/");
}

export function liveSearchPath(keyword: string): string {
  return `/?q=${encodeURIComponent(keyword)}`;
}

/** Platform ids the landing page asks for, in the same order as /api/search. */
export function kPagePlatformParam(): string {
  return PLATFORM_IDS.join(",");
}

export interface KPageData {
  keyword: string;
  slug: string;
  category: string;
  reason: string;
  /** Products already sorted by price, at most K_PAGE_ITEMS. Empty when every shop failed. */
  products: readonly Product[];
  /** One entry per shop that was asked, so copy can name the shops that answered. */
  platforms: readonly PlatformReport[];
  /** When the prices above were captured. Retired pages show this, unedited. */
  fetchedAt: Date;
  /** True once the keyword left the hot list: the page is kept, not regenerated. */
  archived?: boolean;
}

/** Up to three shop names, the ones the reader actually gets prices from. */
function topPlatformNames(products: readonly Product[], platforms: readonly PlatformReport[]): string {
  const seen: string[] = [];
  for (const product of products) {
    const name = platformById(product.platform).name;
    if (!seen.includes(name)) seen.push(name);
    if (seen.length >= MAX_META_PLATFORMS) break;
  }
  if (!seen.length) {
    for (const report of platforms) {
      if (report.status !== "ok" && report.status !== "empty") continue;
      const name = platformById(report.id).name;
      if (!seen.includes(name)) seen.push(name);
      if (seen.length >= MAX_META_PLATFORMS) break;
    }
  }
  return seen.join("、");
}

export function kPageTitle(keyword: string, products: readonly Product[], platforms: readonly PlatformReport[]): string {
  const names = topPlatformNames(products, platforms);
  const shops = names ? `${names} 價格一次看` : "各家價格一次看";
  return `${keyword} 比價｜${shops} — 比比猴`;
}

export function kPageDescription(data: KPageData): string {
  const { keyword, products } = data;
  const shops = topPlatformNames(products, data.platforms);
  if (!products.length) {
    return `${keyword} 的即時比價頁：一次搜尋 momo、PChome、Yahoo 奇摩、酷澎、蝦皮、全聯、東森、樂天、露天，把價格由低到高排好。目前各賣場暫時沒有回傳商品，可以直接點進去看最新價格。`;
  }
  const low = products[0].price;
  const high = products[products.length - 1].price;
  const where = shops ? `${shops} 等平台` : "各平台";
  const range = low === high ? `均一價 ${formatTwd(low)}` : `${formatTwd(low)} 到 ${formatTwd(high)}`;
  return `${keyword} 在 ${where}共 ${products.length} 筆，價格 ${range}。比比猴把各家搜尋結果放在同一頁，由低到高排好，沒有置頂廣告，點進商品直接到原賣場。`;
}

function introParagraph(data: KPageData): string {
  const { keyword, products } = data;
  if (!products.length) {
    return `<p class="lead">目前各平台暫時沒有回傳 <b>${escapeHtml(keyword)}</b> 的商品，可能是被擋或正在換季。你還是可以直接用比比猴即時搜尋再試一次，或到各賣場自己的頁面找。</p>`;
  }
  const shops = topPlatformNames(products, data.platforms);
  const low = products[0].price;
  const high = products[products.length - 1].price;
  const range = low === high ? `價格是 ${formatTwd(low)}` : `價格從 ${formatTwd(low)} 到 ${formatTwd(high)}`;
  const where = shops ? `${shops} 等平台` : "各平台";
  return `<p class="lead"><b>${escapeHtml(keyword)}</b> 目前在 ${escapeHtml(where)}共 ${products.length} 筆，${range}。比比猴把各家搜尋結果放在同一頁、由低到高排好，沒有置頂廣告。價格與庫存以各賣場頁面為準，點進商品就能直接到原賣場。</p>`;
}

function productItem(product: Product, lowest: boolean): string {
  const platform = platformById(product.platform);
  const href = safeUrl(applyAffiliate(product.url));
  const image = safeUrl(product.image);
  const badge = lowest ? `<span class="best">最低價</span>` : "";
  const thumb = image
    ? `<img class="thumb" src="${escapeHtml(image)}" alt="" width="76" height="76" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="thumb" aria-hidden="true"></span>`;
  const inner = `${thumb}<span class="info"><span class="name">${escapeHtml(product.title)}</span><span class="row">${badge}<span class="p">${formatTwd(product.price)}</span><span class="tag">${escapeHtml(platform.name)}</span></span></span>`;
  if (!href) return `<li>${inner}</li>`;
  return `<li><a href="${escapeHtml(href)}" target="_blank" rel="${OUTBOUND_REL}">${inner}</a></li>`;
}

function itemList(items: readonly Product[]): string {
  return items.map((product, index) => productItem(product, index === 0)).join("");
}

function structuredData(data: KPageData, canonical: string): string {
  const graph: Record<string, unknown>[] = [];
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "熱門比價", item: kOverviewUrl() },
      { "@type": "ListItem", position: 3, name: data.keyword, item: canonical },
    ],
  };
  if (data.products.length) {
    graph.push({
      "@type": "ItemList",
      name: `${data.keyword} 比價`,
      numberOfItems: data.products.length,
      itemListElement: data.products.map((product, index) => {
        const href = safeUrl(applyAffiliate(product.url)) ?? canonical;
        const image = safeUrl(product.image);
        const item: Record<string, unknown> = {
          "@type": "Product",
          name: product.title,
          sku: `${product.platform}-${index + 1}`,
          offers: {
            "@type": "Offer",
            price: product.price,
            priceCurrency: "TWD",
            availability: "https://schema.org/InStock",
            url: href,
          },
        };
        if (image) item.image = image;
        return { "@type": "ListItem", position: index + 1, item };
      }),
    });
    const prices = data.products.map((product) => product.price);
    graph.push({
      "@type": "Product",
      name: `${data.keyword} 比價`,
      description: kPageDescription(data),
      url: canonical,
      offers: {
        "@type": "AggregateOffer",
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        priceCurrency: "TWD",
        offerCount: data.products.length,
        availability: "https://schema.org/InStock",
      },
    });
  }
  graph.push(breadcrumb);
  return `<script type="application/ld+json">${scriptJson({ "@context": "https://schema.org", "@graph": graph })}</script>`;
}

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  extraHead?: string;
  script?: string;
}): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeHtml(options.description)}">
<link rel="canonical" href="${escapeHtml(options.canonical)}">
<meta property="og:title" content="${escapeHtml(options.title)}">
<meta property="og:description" content="${escapeHtml(options.description)}">
<meta property="og:url" content="${escapeHtml(options.canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="zh_TW">
<meta property="og:site_name" content="比比猴">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#13B7A2">
<link rel="icon" type="image/png" href="/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icon-180.png">
${options.extraHead ?? ""}<style>${K_PAGE_CSS}</style>
<noscript><style>.list.loading{opacity:1}</style></noscript>
</head>
<body>
<header><div class="inner"><a href="/">比比猴</a><span style="color:#e6fffb;font-size:13px">猴子都會用的比價網站</span></div></header>
${options.body}
<footer><div class="inner"><p>價格與庫存以各購物平台頁面為準。比比猴不販售商品，也沒有置頂廣告。</p><p>比的是各平台搜尋結果的前幾筆，不是該站全部商品。部分連結為聯盟行銷分潤連結，不影響您的購買金額。</p></div></footer>
${options.script ?? ""}
</body>
</html>
`;
}

/**
 * The progressive-enhancement refresh.
 *
 * The HTML already carries a full server-rendered list, so the page is readable
 * with scripting off. With scripting on, this replaces that snapshot the moment
 * the document is ready: it shows a loading state first (so a stale price never
 * looks final), swaps in the live list and the live query time on success, and
 * on failure keeps the snapshot while saying how old it is.
 */
function refreshScript(keyword: string, snapshot: string): string {
  const plan = matchPlan(keyword);
  const config = scriptJson({
    q: keyword,
    platforms: kPagePlatformParam(),
    limit: K_PAGE_ITEMS,
    snapshot,
    names: Object.fromEntries(PLATFORMS.map((platform) => [platform.id, platform.name])),
    // The same relevance rule the server used, so the refresh cannot
    // reintroduce the last-generation accessories it just dropped.
    phrase: plan.phrase,
    forms: plan.tokens.map((token) => [...token.forms]),
  });
  return `<script>
(function(){
  var cfg = ${config};
  var list = document.getElementById("list");
  var stamp = document.getElementById("stamp");
  var fresh = document.getElementById("fresh");
  var empty = document.getElementById("empty");
  if (!list) return;
  function twd(n){ return "NT$" + String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
  function day(iso){
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).replace(/-/g, "/");
  }
  function zhDay(v){
    var m = /^(\\d{4})\\/(\\d{2})\\/(\\d{2})$/.exec(String(v || ""));
    if (!m) return "";
    var label = Number(m[2]) + " 月 " + Number(m[3]) + " 日";
    return Number(m[1]) === new Date().getFullYear() ? label : Number(m[1]) + " 年 " + label;
  }
  function busy(on){
    if (fresh) fresh.hidden = !on;
    if (on) list.classList.add("loading"); else list.classList.remove("loading");
  }
  function note(text, warn){
    if (!stamp) return;
    stamp.textContent = text;
    stamp.hidden = false;
    if (warn) stamp.classList.add("idle"); else stamp.classList.remove("idle");
  }
  function giveUp(){
    busy(false);
    var when = zhDay(cfg.snapshot);
    note(when ? "目前無法取得最新價格，以下為 " + when + "資料" : "目前無法取得最新價格，請稍後再試一次", true);
  }
  function item(p, lowest){
    var li = document.createElement("li");
    var a = document.createElement("a");
    if (typeof p.url === "string" && /^https?:\\/\\//.test(p.url)) {
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener nofollow sponsored";
    }
    if (typeof p.image === "string" && /^https?:\\/\\//.test(p.image)) {
      var pic = document.createElement("img");
      pic.className = "thumb";
      pic.src = p.image;
      pic.alt = "";
      pic.width = 76;
      pic.height = 76;
      pic.loading = "lazy";
      pic.decoding = "async";
      pic.referrerPolicy = "no-referrer";
      a.appendChild(pic);
    }
    var info = document.createElement("span");
    info.className = "info";
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = String(p.title || "");
    var row = document.createElement("span");
    row.className = "row";
    if (lowest) {
      var best = document.createElement("span");
      best.className = "best";
      best.textContent = "最低價";
      row.appendChild(best);
    }
    var price = document.createElement("span");
    price.className = "p";
    price.textContent = twd(p.price);
    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = cfg.names[p.platform] || String(p.platform || "");
    row.appendChild(price);
    row.appendChild(tag);
    info.appendChild(name);
    info.appendChild(row);
    a.appendChild(info);
    li.appendChild(a);
    return li;
  }
  function fold(v){
    var s = String(v == null ? "" : v);
    if (s.normalize) s = s.normalize("NFKC");
    return s.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, "");
  }
  function rankOf(title){
    var hay = fold(title);
    if (!cfg.forms.length) return 1;
    for (var i = 0; i < cfg.forms.length; i++) {
      var forms = cfg.forms[i], hit = false;
      for (var j = 0; j < forms.length; j++) {
        if (forms[j] && hay.indexOf(forms[j]) >= 0) { hit = true; break; }
      }
      if (!hit) return 2;
    }
    return cfg.phrase && hay.indexOf(cfg.phrase) >= 0 ? 0 : 1;
  }
  function pick(results){
    var byShop = {}, picked = [], seen = {}, cursors = {}, order = cfg.platforms.split(",");
    results.forEach(function(p, i){
      if (!p || typeof p.price !== "number" || !isFinite(p.price) || p.price <= 0) return;
      if (typeof p.title !== "string" || !p.title.replace(/\\s+/g, "")) return;
      var r = rankOf(p.title);
      if (r > 1) return;
      var print = p.platform + "|" + fold(p.title) + "|" + p.price;
      if (seen[print]) return;
      seen[print] = true;
      var row = { p: p, r: r, i: i };
      var queue = byShop[p.platform] || (byShop[p.platform] = []);
      queue.push(row);
    });
    function cmp(a, b){
      return a.r - b.r || a.p.price - b.p.price || (a.p.rank || 0) - (b.p.rank || 0) || a.i - b.i;
    }
    for (var key in byShop) if (Object.prototype.hasOwnProperty.call(byShop, key)) byShop[key].sort(cmp);
    // The same round-robin the server runs: one row per shop per turn, so a
    // single shop cannot fill the page with its own cheap listings. Strong
    // matches go first; weaker ones only fill what is left.
    for (var tier = 0; tier <= 1 && picked.length < cfg.limit; tier++) {
      var moved = true;
      while (picked.length < cfg.limit && moved) {
        moved = false;
        for (var k = 0; k < order.length && picked.length < cfg.limit; k++) {
          var shop = order[k];
          if (!byShop[shop]) continue;
          // Only a row that is taken moves the cursor; a weaker row skipped in
          // this tier has to stay available for the next one.
          var at = cursors[shop] || 0;
          while (at < byShop[shop].length && byShop[shop][at].r > tier) at++;
          if (at >= byShop[shop].length) continue;
          picked.push(byShop[shop][at]);
          cursors[shop] = at + 1;
          moved = true;
        }
      }
    }
    picked.sort(function(a, b){
      return a.p.price - b.p.price || a.r - b.r || (a.p.rank || 0) - (b.p.rank || 0) || a.i - b.i;
    });
    return picked.map(function(row){ return row.p; });
  }
  function draw(body){
    if (!body || !Array.isArray(body.results)) return false;
    var items = pick(body.results);
    if (!items.length) return false;
    var frag = document.createDocumentFragment();
    items.forEach(function(p, i){ frag.appendChild(item(p, i === 0)); });
    list.replaceChildren(frag);
    list.hidden = false;
    if (empty) empty.hidden = true;
    var when = body.fetchedAt ? day(body.fetchedAt) : "";
    if (when) note("價格為 " + when + " 查詢，實際依各賣場為準", false);
    busy(false);
    return true;
  }
  function run(){
    var url = "/api/search?q=" + encodeURIComponent(cfg.q) + "&platforms=" + encodeURIComponent(cfg.platforms);
    try {
      fetch(url, { headers: { accept: "application/json" } })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(body){ if (!draw(body)) giveUp(); })
        .catch(giveUp);
    } catch (e) { giveUp(); }
  }
  var started = false;
  function start(){ if (started) return; started = true; run(); }
  busy(true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>`;
}

/**
 * `now` is only used by callers that have no captured date yet (a page whose
 * search has not answered this request); a snapshot always wins over it.
 */
export function renderKPage(data: KPageData, now: Date = new Date()): string {
  const canonical = kPageUrl(data.slug);
  const title = kPageTitle(data.keyword, data.products, data.platforms);
  const description = kPageDescription(data);
  const captured = data.fetchedAt.getTime() > 0 ? data.fetchedAt : now;
  const snapshot = taipeiDate(captured);
  const list = itemList(data.products);
  const hasItems = data.products.length > 0;
  const body = `<main>
<nav class="crumbs" aria-label="路徑"><a href="/">首頁</a>  ›  <a href="/k/">熱門比價</a>  ›  <span>${escapeHtml(data.keyword)}</span></nav>
<h1>${escapeHtml(data.keyword)} 比價</h1>
${data.reason ? `<p class="why">為什麼熱門：${escapeHtml(data.reason)}</p>` : ""}
${data.archived ? `<p class="why">這個關鍵字已經從熱門清單退下來，這一頁保留原本的網址與存檔價格，不會每天重抓；即時價格請點下面的按鈕。</p>` : ""}
${introParagraph(data)}
<a class="cta" href="${escapeHtml(liveSearchPath(data.keyword))}">看即時比價</a>
<p class="stamp" id="fresh" role="status" aria-live="polite" hidden>正在取得最新價格…</p>
<p class="stamp" id="stamp"${hasItems ? "" : " hidden"} data-snapshot="${escapeHtml(snapshot)}">價格為 ${escapeHtml(snapshot)} 查詢，實際依各賣場為準</p>
<ul class="list loading" id="list" data-snapshot="${escapeHtml(snapshot)}"${hasItems ? "" : " hidden"}>${list}</ul>
<p class="empty" id="empty"${hasItems ? " hidden" : ""}>${data.archived ? "這一頁沒有留下存檔商品，點上面的「看即時比價」可以直接查目前價格。" : "各賣場這次沒回傳商品，可以先看上面的即時比價，或稍後再回來。"}</p>
<p class="more"><a href="/k/">看更多熱門比價</a> · <a href="/">回首頁</a></p>
</main>`;
  return shell({
    title,
    description,
    canonical,
    body,
    extraHead: `${structuredData(data, canonical)}\n`,
    script: refreshScript(data.keyword, snapshot),
  });
}

export interface OverviewItem extends HotKeyword {
  slug: string;
}

/** Hot keywords for this week, in their categories. */
export function hotOverviewItems(): { category: string; items: OverviewItem[] }[] {
  const hot = HOT_KEYWORDS.filter((item) => slugForKeyword(item.keyword));
  return groupHotKeywords(hot).map((group) => ({
    category: group.category,
    items: group.items.map((item) => ({ ...item, slug: slugForKeyword(item.keyword) as string })),
  }));
}

/**
 * Pages that used to be hot and are kept forever. They stay listed here so the
 * links never go dead and a crawler can still reach them, but they are marked
 * as past pages rather than advertised as this week's picks.
 */
export function archivedOverviewItems(): OverviewItem[] {
  const known = new Set(HOT_KEYWORDS.map((item) => item.keyword));
  return Object.keys(KEYWORD_SLUGS)
    .filter((keyword) => !known.has(keyword))
    .map((keyword) => ({ keyword, category: "其他比價頁", reason: "先前整理的比價頁", slug: slugForKeyword(keyword) as string }));
}

export function overviewItems(): { category: string; items: OverviewItem[] }[] {
  const groups = hotOverviewItems();
  const archived = archivedOverviewItems();
  return archived.length ? [...groups, { category: "其他比價頁", items: archived }] : groups;
}

export function renderKOverview(now: Date = new Date()): string {
  const groups = overviewItems();
  const hotGroups = hotOverviewItems();
  const total = hotGroups.reduce((sum, group) => sum + group.items.length, 0);
  const archived = archivedOverviewItems();
  const title = `熱門比價 — ${total} 個人氣商品關鍵字 — 比比猴`;
  const description = `比比猴整理的熱門商品關鍵字，共 ${total} 個：${hotGroups
    .flatMap((group) => group.items)
    .slice(0, 6)
    .map((item) => item.keyword)
    .join("、")} 等。點進去就能看各平台即時價格，由低到高排好。`;
  const sections = groups
    .map(
      (group) => `<section>
<h2>${escapeHtml(group.category)}</h2>
<ul class="list plain">${group.items
        .map(
          (item) =>
            `<li><a href="${escapeHtml(kPagePath(item.slug))}"><span class="info"><span class="name">${escapeHtml(item.keyword)} 比價</span><span class="row"><span class="tag">${escapeHtml(item.reason)}</span></span></span><span class="p">›</span></a></li>`,
        )
        .join("")}</ul>
</section>`,
    )
    .join("");
  const body = `<main>
<nav class="crumbs" aria-label="路徑"><a href="/">首頁</a>  ›  <span>熱門比價</span></nav>
<h1>熱門比價</h1>
<p class="lead">這裡是比比猴整理的人氣商品，共 <b>${total}</b> 個關鍵字。點一個就能看各平台目前價格，由低到高排好，沒有置頂廣告。</p>
${archived.length ? `<p class="why">下面另有 ${archived.length} 個先前整理的比價頁，網址不會失效，價格以頁上標示的查詢日為準。</p>` : ""}
<p class="stamp">價格為 ${escapeHtml(taipeiDate(now))} 查詢，實際依各賣場為準</p>
<a class="cta" href="/">回首頁搜尋</a>
${sections}
<p class="more"><a href="/">回首頁</a></p>
</main>`;
  return shell({
    title,
    description,
    canonical: kOverviewUrl(),
    body,
    extraHead: `<script type="application/ld+json">${scriptJson({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "首頁", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "熱門比價", item: kOverviewUrl() },
      ],
    })}</script>\n`,
  });
}

export function renderKNotFound(pathname: string): string {
  const body = `<main>
<nav class="crumbs" aria-label="路徑"><a href="/">首頁</a>  ›  <a href="/k/">熱門比價</a></nav>
<h1>找不到這個比價頁</h1>
<p class="lead">你開的網址 <code>${escapeHtml(pathname)}</code> 沒有對應的比價頁，可能已經換季下架或網址打錯。</p>
<p class="more"><a href="/k/">看所有熱門比價</a> · <a href="/">回首頁搜尋</a></p>
</main>`;
  return shell({
    title: "找不到這個比價頁 — 比比猴",
    description: "這個比價頁不存在。回比比猴首頁就能搜尋各平台價格。",
    canonical: kOverviewUrl(),
    body,
    extraHead: '<meta name="robots" content="noindex">\n',
  });
}

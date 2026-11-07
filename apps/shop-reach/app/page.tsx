"use client";

import { useEffect, useState } from "react";

type ShopName = "coupang" | "rakuten";

interface ShownProduct {
  title: string;
  price: number;
  image: string;
  url: string;
}

interface RowSkips {
  title: number;
  price: number;
  url: number;
  duplicate: number;
}

interface ProbeReport {
  platform: ShopName | null;
  testedAt: string;
  sent: boolean;
  httpStatus: number | null;
  parsed: boolean;
  count: number | null;
  ok: boolean;
  reason: string | null;
  products: ShownProduct[];
  emptyCause: "no_rows" | "rows_unusable" | null;
  rawRows: number | null;
  skipped: RowSkips | null;
}

interface SessionState {
  signedIn: boolean;
  live: boolean;
  simulated: boolean;
}

const EMPTY = "尚未測試";

export default function Page() {
  const [keyword, setKeyword] = useState("");
  const [session, setSession] = useState<SessionState | null>(null);
  const [pending, setPending] = useState<ShopName | null>(null);
  const [results, setResults] = useState<Partial<Record<ShopName, ProbeReport>>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as SessionState;
        setSession({
          signedIn: body.signedIn === true,
          live: body.live === true,
          simulated: body.simulated === true,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession({ signedIn: false, live: false, simulated: false });
      });
    return () => controller.abort();
  }, []);

  async function run(platform: ShopName) {
    if (pending) return;
    setPending(platform);
    try {
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: { "content-type": "application/json", "x-shop-reach": "1" },
        body: JSON.stringify({ platform, keyword }),
        cache: "no-store",
      });
      const body = (await response.json()) as Partial<ProbeReport>;
      setResults((current) => ({
        ...current,
        [platform]: {
          platform,
          testedAt: typeof body.testedAt === "string" ? body.testedAt : new Date().toISOString(),
          sent: body.sent === true,
          httpStatus: typeof body.httpStatus === "number" ? body.httpStatus : null,
          parsed: body.parsed === true,
          count: typeof body.count === "number" ? body.count : null,
          ok: body.ok === true,
          reason: typeof body.reason === "string" ? body.reason : response.ok ? null : `http_${response.status}`,
          products: shownProducts(body.products),
          emptyCause: body.emptyCause === "no_rows" || body.emptyCause === "rows_unusable" ? body.emptyCause : null,
          rawRows: typeof body.rawRows === "number" ? body.rawRows : null,
          skipped: shownSkips(body.skipped),
        },
      }));
    } catch {
      setResults((current) => ({
        ...current,
        [platform]: {
          platform,
          testedAt: new Date().toISOString(),
          sent: false,
          httpStatus: null,
          parsed: false,
          count: null,
          ok: false,
          reason: "exception: 頁面無法完成這次請求",
          products: [],
          emptyCause: null,
          rawRows: null,
          skipped: null,
        },
      }));
    } finally {
      setPending(null);
    }
  }

  return (
    <main>
      <h1>賣場連線測試</h1>
      <p className="lead">
        確認已發布的 Cursor Apps 後端能不能直接取得酷澎與樂天商品。每次按鈕只送一次請求，不重試、不輪詢、不換 IP。
      </p>
      <Banner session={session} />
      <label htmlFor="keyword">關鍵字</label>
      <input
        id="keyword"
        value={keyword}
        maxLength={40}
        autoComplete="off"
        placeholder="例如：耳機"
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="actions">
        <button className="coupang" type="button" disabled={pending !== null} onClick={() => void run("coupang")}>
          {pending === "coupang" ? "酷澎查詢中" : "向酷澎查一次"}
        </button>
        <button className="rakuten" type="button" disabled={pending !== null} onClick={() => void run("rakuten")}>
          {pending === "rakuten" ? "樂天查詢中" : "向樂天查一次"}
        </button>
      </div>
      <div className="results">
        <Result title="酷澎" report={results.coupang} />
        <Result title="樂天" report={results.rakuten} />
      </div>
      <p className="note">
        酷澎金鑰使用應用秘密 <code>COUPANG_ACCESS_KEY</code> 與 <code>COUPANG_SECRET_KEY</code>。樂天這條路徑沒有金鑰。秘密值只留在應用設定，不會進頁面、程式、日誌或回應。
      </p>
      <p className="note">
        發布時請把誰能開啟選成只有你，並且不要邀請其他人。這個頁面不能指定網址，也不會改比比猴正式站或現有 Cloudflare 設定。
      </p>
    </main>
  );
}

function Banner({ session }: { session: SessionState | null }) {
  if (!session) return <p className="banner">正在確認這個環境會不會送出請求。</p>;
  if (!session.signedIn) return <p className="banner">請用你的 Cursor 帳號開啟這個應用。</p>;
  if (session.simulated) {
    return (
      <p className="banner">
        這是本機預覽，畫面上的登入者是模擬的。按鈕不會向酷澎或樂天送出請求。
      </p>
    );
  }
  if (!session.live) {
    return <p className="banner">這是預覽環境。按鈕不會向賣場送出請求，正式發布後的應用後端才會送。</p>;
  }
  return <p className="banner">現在的按鈕會由已發布的應用後端各送出一次請求。同一個賣場四秒內的再按一次不會再送。</p>;
}

function Result({ title, report }: { title: string; report: ProbeReport | undefined }) {
  const outcome = !report ? EMPTY : !report.sent ? "未送出" : report.ok ? "成功" : "未成功";
  const outcomeClass = !report || !report.sent ? "" : report.ok ? "ok" : "bad";
  return (
    <article>
      <h2>{title}</h2>
      <dl>
        <dt>結果</dt>
        <dd className={outcomeClass}>{outcome}</dd>
        <dt>測試時間</dt>
        <dd>{report ? formatTime(report.testedAt) : "—"}</dd>
        <dt>有沒有送出</dt>
        <dd>{report ? (report.sent ? "有" : "沒有") : "—"}</dd>
        <dt>HTTP 狀態碼</dt>
        <dd>{report?.httpStatus ?? "—"}</dd>
        <dt>解析商品</dt>
        <dd>{report ? (report.sent ? (report.parsed ? "已解析" : "未解析") : "—") : "—"}</dd>
        <dt>商品筆數</dt>
        <dd>{report?.count ?? "—"}</dd>
        <dt>原因</dt>
        <dd>{report?.reason ? explain(report.reason, title, report) : "—"}</dd>
      </dl>
      {report && report.products.length > 0 ? <ProductList products={report.products} /> : null}
    </article>
  );
}

function ProductList({ products }: { products: readonly ShownProduct[] }) {
  return (
    <ul className="products">
      {products.map((product) => (
        <li key={product.url}>
          <a href={product.url} target="_blank" rel="noopener noreferrer nofollow sponsored">
            {product.image ? <img src={product.image} alt="" width={72} height={72} /> : <span className="ph" />}
            <span>
              <span className="name">{product.title}</span>
              <span className="price">{formatPrice(product.price)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function formatPrice(amount: number): string {
  return `$${new Intl.NumberFormat("zh-TW").format(amount)}`;
}

function shownProducts(value: unknown): ShownProduct[] {
  if (!Array.isArray(value)) return [];
  const products: ShownProduct[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || typeof row.price !== "number" || !Number.isFinite(row.price)) continue;
    if (typeof row.url !== "string" || !row.url.startsWith("https://")) continue;
    const image = typeof row.image === "string" && row.image.startsWith("https://") ? row.image : "";
    products.push({ title: row.title, price: row.price, image, url: row.url });
  }
  return products;
}

function shownSkips(value: unknown): RowSkips | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const count = (name: string) => (typeof row[name] === "number" && Number.isFinite(row[name]) ? (row[name] as number) : 0);
  return { title: count("title"), price: count("price"), url: count("url"), duplicate: count("duplicate") };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const local = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${local}（台北） ${iso}`;
}

function explain(reason: string, shop: string, report: ProbeReport): string {
  if (reason === "empty_no_rows") return `${shop}回傳的商品清單是空的，沒有任何一列。`;
  if (reason === "empty_rows_unusable") {
    const skipped = report.skipped;
    if (!skipped || report.rawRows === null) return `${shop}有回傳商品列，但沒有一列可以列出。`;
    return `${shop}回了 ${report.rawRows} 列，沒有一列同時有品名、售價和可用網址。缺品名 ${skipped.title}、缺售價 ${skipped.price}、網址不能用 ${skipped.url}、重複 ${skipped.duplicate}。`;
  }
  if (reason.startsWith("missing_keys")) return `酷澎金鑰尚未設定。${reason}`;
  const known: Record<string, string> = {
    preview_only: "預覽環境不會向賣場送出請求。",
    preview_host: "預覽主機不會向賣場送出請求。",
    empty_keyword: "請先輸入關鍵字。",
    keyword_too_long: "關鍵字最多 40 個字。",
    challenge: "HTTP 回應像驗證或封鎖頁，不算成功。",
    parse_error: "回應裡沒有可解析的商品清單，不算成功。",
    person_only: "這個查詢只接受已登入的人。",
    cooldown: "同一個賣場四秒內只送一次。",
    busy: "同一個賣場的上一筆請求還在進行。",
    bad_request: "請求內容無法使用。",
  };
  if (known[reason]) return known[reason];
  if (reason.startsWith("http_")) return `賣場回應 ${reason.slice(5)}，不算成功。`;
  if (reason.startsWith("html_")) return `回應不是商品資料。${reason}`;
  if (reason.startsWith("rcode_")) return `酷澎回應代碼無法當成商品清單。${reason}`;
  if (reason.startsWith("exception:")) return reason;
  return reason;
}

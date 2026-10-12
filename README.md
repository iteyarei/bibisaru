# 比比猴

台灣購物比價網站。輸入一個關鍵字，把 momo、PChome、酷澎、Yahoo 奇摩購物中心、蝦皮的搜尋結果放在一起，預設依價格由低到高排列。

這一版沒有廣告、沒有聯盟追蹤碼。站名英文 slug 是 `bibisaru`。

## 本地開發

需要 Node.js 20 以上。

```bash
npm install
npm test
npm run build
npm run pages:dev
```

`npm run pages:dev` 會用 Wrangler 在 <http://127.0.0.1:8788> 同時提供靜態檔與 `functions/`。只跑 `npm run dev` 時，畫面看得到，但 `/api/search` 沒有後端。

對五個平台各打一次真的搜尋（會連到對方網站）：

```bash
npm run test:live
```

## Cloudflare Pages

在 Cloudflare 儀表板新增 Pages 專案，連到這個 Git 儲存庫。

| 設定 | 值 |
| --- | --- |
| 生產分支 | `main` |
| 框架預設 | None |
| 建置指令 | `npm run build` |
| 建置輸出目錄 | `dist` |
| 根目錄 | 儲存庫根目錄 |
| Node.js | 20 或 22 |
| 環境變數 | 沒有。v1 不需要任何 secret |
| Compatibility date | `2026-10-12` |
| Compatibility flags | 無 |

`functions/` 要留在儲存庫根目錄，不要放進 `dist`。Pages 會自動把它當成 Pages Functions。`/api/search`、`/robots.txt`、`/sitemap.xml` 都從這裡來。

專案名稱建議用 `bibisaru`，免費網址就會是 `https://bibisaru.pages.dev`。`index.html` 裡的 canonical 與 Open Graph 網址目前寫這個。若實際網址不同，或之後改接自己的網域，請改 `index.html` 裡的這三個網址：`canonical`、`og:url`、`og:image`。`robots.txt` 和 `sitemap.xml` 會跟著當時的網址走，不用改。

也可以之後用 Wrangler：`npx wrangler pages deploy dist`。`wrangler.toml` 已經寫好輸出目錄與 compatibility date。

## 搜尋怎麼運作

`GET /api/search?q=耳機&platforms=momo,pchome,coupang,yahoo,shopee`

每家最多回 24 筆，欄位是 `{ platform, title, price, image, url }`。某一家失敗不會讓其他家一起失敗。失敗的那一家在畫面上顯示「暫時無法取得」，並給一顆按鈕打開該平台自己的搜尋頁。

同一組關鍵字與平台組合會在邊緣快取約 3 分鐘，瀏覽器再快取 30 秒。每個 IP 大約每分鐘 20 次未命中快取的搜尋。沒有重試。

排除關鍵字、平台開關、排序都在瀏覽器裡做，並記在 `localStorage`（`bibisaru.prefs.v1`）。外連是 `target="_blank"`、`rel="noopener nofollow sponsored"`。

## 這台機器實測（2026-10-12）

關鍵字「耳機」，每個平台各請求一次。

| 平台 | 結果 | 做法 |
| --- | --- | --- |
| momo | 有抓到商品（24 筆） | 讀搜尋頁 HTML 裡的商品清單 |
| PChome | 有抓到商品（20 筆）。連續打太多次時對方會回 429，畫面改顯示「暫時無法取得」 | 公開搜尋 JSON：`ecshweb.pchome.com.tw/search/v3.3/all/results`，需要 Referer |
| Yahoo 奇摩購物中心 | 有抓到商品（24 筆） | 讀搜尋頁內嵌的 `isoredux-data` |
| 酷澎 | 不穩定 | 第一次 `/np/search` 回了完整商品頁，轉接器可解析（例如 EarPods，$539）。同一台機器稍後再打就變成 403。失敗時不捏造商品，改成前往酷澎搜尋 |
| 蝦皮 | 拿不到 | 搜尋 API 回 403（錯誤碼 90309999），搜尋頁是空殼。只提供前往蝦皮搜尋 |

酷澎與蝦皮在 Cloudflare 的出口 IP 上可能和這台機器不一樣：有機會成功，也有機會繼續被擋。程式兩邊都處理了。

## 風險

- 這些平台的使用條款多半不允許自動抓搜尋結果。這一版量很小、有快取、沒有聯盟參數，但仍可能違反對方條款，也可能隨時被擋。
- momo、Yahoo、酷澎是解析網頁，版面一改就會變成「暫時無法取得」。PChome 走 JSON，相對穩，但也沒有正式對外匯的保證。
- 比的是每一家搜尋結果的前一頁，不是該站全部商品。最低價指的是這一批裡面最便宜的。
- 有些平台會把推薦商品混進搜尋結果，標價仍是該頁上的價格。
- 商品圖是直接連到各平台的圖床，對方若擋外連，圖會變成灰塊，商品與價格還在。
- 快取約 3 分鐘，價格可能和平台當下不一致。以平台頁面為準。

## 換圖與聯盟開關

吉祥物與圖示都在 `public/`，檔名固定，蓋過去即可：

- `public/mascot.png`：頁首與空狀態
- `public/icon-32.png`、`icon-64.png`、`icon-180.png`、`icon-192.png`、`icon-512.png`
- `public/favicon.ico`：內含 16、32、48、64。32 與 64 來自上面的 PNG。換圖示後若要讓 `.ico` 跟著換，需重新產生

介面文字集中在 `shared/i18n.ts`，目前只有繁體中文。

聯盟參數只准加在 `shared/affiliate.ts` 的 `applyAffiliate`。`AFFILIATE_ENABLED` 必須維持 `false`，乾淨版才不會改寫任何外出網址。單元測試會鎖住這個開關。

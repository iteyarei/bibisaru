# 比比猴

台灣購物比價網站。輸入一個關鍵字，把 momo、PChome、酷澎、Yahoo 奇摩購物中心、蝦皮的搜尋結果放在一起，預設依價格由低到高排列。

這一版沒有廣告。部分外出連結帶聯盟分潤參數，頁尾有揭露。站名英文 slug 是 `bibisaru`。

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

也可以之後用 Wrangler：`npx wrangler pages deploy dist`。`wrangler.toml` 已經寫好輸出目錄、compatibility date，以及 Pages Functions 的 Smart Placement（`[placement] mode = "smart"`）。Smart Placement 不能指定或避開某個機房。

## 美國抓取 Worker（bibisaru-fetch）

全聯、酷澎、蝦皮從 Cloudflare 的 HKG 會間歇回 403，從美國（IAD）可以。Pages Function 仍在訪客附近執行。另外一個 Worker `bibisaru-fetch` 用 Placement Hint 釘在最靠近 `aws:us-east-1` 的機房，由它代打這三家。

文件：

- Placement（含 `[placement] region = "aws:us-east-1"`）：https://developers.cloudflare.com/workers/configuration/placement/
- 同一頁寫明 Smart Placement「available on all Workers plans」。Region hint 是該頁的明確放置方式，changelog 稱為 Smart Placement 的延伸，定價頁沒有把它列成付費功能：https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/
- Workers Builds：https://developers.cloudflare.com/workers/ci-cd/builds/

沒有設定 `FETCH_PROXY_URL` 和 `PROXY_TOKEN` 時，Pages 仍直接抓。兩個都有值時，全聯、酷澎、蝦皮改打 Worker；連線失敗或非 JSON 就退回直接抓。Worker 回 401 時不退回，原因是 `exception: proxy unauthorized`，金鑰不會出現在 log 或原因裡。酷澎的 Open API 金鑰要設在 Worker 上，不會從 Pages 傳過去。

### 你要做的部署

用儀表板的 Workers Builds（Git）：

1. 打開 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)，Create application → Import a repository。
2. 選 GitHub 帳號，匯入 `iteyarei/bibisaru`，生產分支 `main`。
3. 專案名稱填 `bibisaru-fetch`。這個名稱必須和 `workers/fetch-proxy/wrangler.toml` 的 `name` 一樣。
4. Root directory 填 `workers/fetch-proxy`。Build command 留空。Deploy command 用 `npx wrangler deploy`。
5. Build watch paths 加上 `workers/fetch-proxy/*`、`shared/*`、`functions/lib/*`，這樣共用程式改了也會重新部署。
6. Save and Deploy。部署完成後，Overview 會顯示 `https://bibisaru-fetch.<你的帳號>.workers.dev`。
7. 打開這個 Worker → Settings → Variables and Secrets，新增三個 **Secret**（不要用純文字變數）：
   - `PROXY_TOKEN`：自己產生的一長串隨機字，至少 32 個字元。
   - `COUPANG_ACCESS_KEY`：和 Pages 上的酷澎 Access Key 相同。
   - `COUPANG_SECRET_KEY`：和 Pages 上的酷澎 Secret Key 相同。
8. 打開 Pages 專案 `bibisaru` → Settings → Variables and Secrets，新增：
   - `FETCH_PROXY_URL`：上一步的 `https://bibisaru-fetch.<你的帳號>.workers.dev`（不要加路徑）。
   - `PROXY_TOKEN`：和 Worker 上同一個值，類型選 Secret。
9. 重新部署 Pages（或再推一次 `main`），讓這兩個變數進到 Function。

或在本機，從儲存庫根目錄：

```bash
npx wrangler deploy --config workers/fetch-proxy/wrangler.toml
npx wrangler secret put PROXY_TOKEN --config workers/fetch-proxy/wrangler.toml
npx wrangler secret put COUPANG_ACCESS_KEY --config workers/fetch-proxy/wrangler.toml
npx wrangler secret put COUPANG_SECRET_KEY --config workers/fetch-proxy/wrangler.toml
```

然後把印出來的 workers.dev 網址和同一個 `PROXY_TOKEN` 設到 Pages，同上。不要把密鑰寫進 git。

## 搜尋怎麼運作

`GET /api/search?q=耳機&platforms=momo,pchome,yahoo,coupang,shopee,pxgo,etmall,kingstone,sanmin,rakuten,ruten`

每家最多回 24 筆，欄位是 `{ platform, title, price, image, url }`。某一家失敗不會讓其他家一起失敗。失敗的那一家在畫面上顯示「暫時無法取得」，底下用淺灰色小字寫原因和 Cloudflare 機房（例如「原因：http_403 · HKG · fetchColo IAD」），並給一顆按鈕打開該平台自己的搜尋頁。`meta.colo` 是訪客進來的機房。`meta.fetchColo` 是這次函式實際打出去的機房，來自 `https://www.cloudflare.com/cdn-cgi/trace` 的 `colo`，不含 IP。全聯從 HKG 會被 403，從 IAD 可以；Smart Placement 不會因此改走 IAD。有設定美國 Worker 時，全聯、酷澎、蝦皮改由那個 Worker 抓，卡片上的 `fetchColo` 是 Worker 回報的機房。

同一組關鍵字與平台組合，全部抓到時會在邊緣快取約 3 分鐘，瀏覽器再快取 30 秒。快取鍵帶這次部署的版本，新版本不會沿用舊結果。若 momo、PChome、Yahoo、全聯、東森、金石堂、三民、樂天、露天有一家失敗，這次回應是 `no-store`，不會被快取。酷澎、蝦皮常常只有前往搜尋，不算這次失敗。每個抓取的店（酷澎除外）失敗或逾時會再要一次：全聯隔約 0.8 秒、單次逾時 10 秒，其他店隔約 0.3 秒、單次逾時 8 秒。各店平行抓，最慢的一條仍低於 Pages 約 30 秒。每個 IP 大約每分鐘 20 次未命中快取的搜尋。

搜尋框和排除關鍵字框在有字時，文字右側會出現清除鈕，只清空該欄並把游標放回去，不會重新搜尋。結果卡底部的「搜尋同款」會把商品名收成品牌加型號（或前幾個詞）再搜全部平台。排除關鍵字、平台開關、排序、價格範圍都在瀏覽器裡做，並記在 `localStorage`（`bibisaru.prefs.v1`）。價格範圍空白表示不限；若最低填得比最高高，會把兩個數字對調後再篩。搜尋欄用空格分開的每個詞都要出現在商品名稱裡（忽略大小寫、全形半形，也忽略空格和符號，所以 fold8 對得上 Fold 8）。超過兩個字、中間沒有空格的中文詞，若整段對不上，會再用品牌和品類詞拆開（大同、電鍋這類；沒有收錄的部分用斷詞，再不行就兩字一組），片段都要出現、順序不限。整段連在一起的結果，在相關排序裡排在拆開比對的前面。同義詞在 `shared/synonyms.ts`，例如 NS2 與 Switch 2、PS5 與 PlayStation 5。各平台仍用整句去搜，過濾在瀏覽器做。PChome 的商品名稱若少了品牌、說明第一行只是多出短短的品牌前綴，會用那一行當名稱。外連是 `target="_blank"`、`rel="noopener nofollow sponsored"`。

能判斷庫存的店，已售完的商品預設不列出：momo（`goodsStock` 為 0）、Yahoo（`ec_has_stock` 為 0 或庫存數為 0）、全聯（`is_sold_out` 或庫存為 0）、東森（`haveStocks` 為 false）、金石堂（按鈕是「貨到通知」）、三民（標成「無庫存」）、樂天（只列 `itemStatus` 為 `Available`）、露天（`StockQty` 為 0 或不是直購）。PChome 的搜尋 JSON 沒有庫存欄位，無法判斷，所以照頁面上的結果列出。酷澎、蝦皮目前多半是前往搜尋，沒有可判斷的庫存。

## 熱門比價頁（/k/）

每個熱門關鍵字有自己的靜態網址，例如 <https://bibisaru.pages.dev/k/chushiji/>。`functions/k/[[path]].ts` 在伺服器端先抓好商品、排好價，再把整頁 HTML 送出去，所以搜尋引擎和沒有開 JavaScript 的人都看得到完整內容。`/k/` 是總覽，依分類列出本週的熱門關鍵字。

每一頁有自己固定的 slug，對照表在 `shared/k-slugs.json`。**已經發布的 slug 永遠不改**，改了等於讓那一頁的排名歸零。新增熱門關鍵字時要一起加一筆；`npm run build` 前的 `scripts/check-k-slugs.mjs` 會擋下沒有 slug、重複或不合法 slug 的建置。

從熱門清單退下來的關鍵字**不會刪頁**：

- slug 留在 `k-slugs.json`，頁面繼續在原網址回應 200，不會 404，也不會轉址。
- 不再每天重抓，改顯示 `shared/k-snapshots.json` 裡最後一次的存檔價格，日期就用存檔當天。檔案格式是 `{ "<slug>": { "date": "YYYY/MM/DD", "category": "3C", "products": [...] } }`，商品欄位和 `/api/search` 一樣。
- sitemap 的 `lastmod` 用存檔日，不是當天，才不會讓爬蟲每天重抓一個凍結的頁面。
- 總覽頁把它收在「其他比價頁」，不混進本週熱門。

所以換季時要做的事只有兩件：把關鍵字從 `shared/hot-keywords.json` 拿掉，順手把它最後一次的結果貼進 `k-snapshots.json`。沒貼也不會壞，只是那一頁會說「這一頁沒有留下存檔商品」。

## 價格新鮮度

頁面送出的 HTML 是伺服器剛抓的價格（邊緣快取約 3 分鐘）。瀏覽器一打開就自己再問一次 `/api/search`：

1. 先顯示「正在取得最新價格…」，列表淡掉，避免把舊價格當成現在的最終價。
2. 成功：整份列表、價格和「價格為 YYYY/MM/DD 查詢」那行一起換成這次抓到的時間。
3. 失敗：保留原本的存檔，改成「目前無法取得最新價格，以下為 X 月 X 日資料」。

每頁都有一顆「看即時比價」按鈕，連到 `/?q=<keyword>` 走完整的即時搜尋。這顆按鈕和整段更新腳本都在 `shared/k-page.ts`。

## 這台機器實測（2026-10-12）

關鍵字「耳機」，每個平台各請求一次。

平台開關順序：momo、PChome、Yahoo奇摩、酷澎、蝦皮，後面再加上面有接上的店。

| 平台 | 結果 | 做法 |
| --- | --- | --- |
| momo | 有抓到商品（24 筆） | 讀搜尋頁 HTML 裡的商品清單 |
| PChome | 有抓到商品（20 筆）。連續打太多次時對方會回 429，畫面改顯示「暫時無法取得」 | 公開搜尋 JSON：`ecshweb.pchome.com.tw/search/v3.3/all/results`，需要 Referer |
| Yahoo 奇摩購物中心 | 有抓到商品（24 筆） | 讀搜尋頁內嵌的 `isoredux-data` |
| 酷澎 | Partners Open API | 有 `COUPANG_ACCESS_KEY` 與 `COUPANG_SECRET_KEY` 時打 `api-gateway.tw.coupang.com` 商品搜尋，最多 10 筆，售價用 `productPrice`。金鑰缺或 API 失敗時不捏造商品，顯示「暫時無法取得」，並給分潤搜尋連結 |
| 蝦皮 | 拿不到 | 搜尋 API 回 403（錯誤碼 90309999），搜尋頁是空殼。只提供前往蝦皮搜尋 |
| 全聯 | 有抓到商品（24 筆） | 全聯全電商公開搜尋 `api-pxbox.es.pxmart.com.tw` 的 `single_search` |
| 東森 | 有抓到商品（48 筆，頁面只用前 24） | `etmall.com.tw/Search/Get` JSON，用成交價 `finalPrice` |
| 金石堂 | 有抓到商品（48 筆，頁面只用前 24） | 讀搜尋頁 HTML 的商品卡 |
| 三民 | 有抓到商品 | 讀搜尋頁 HTML。有優惠價就用優惠價，否則用定價 |
| 樂天 | 有抓到商品（約 24 筆，去重後上限 24） | 讀搜尋頁內嵌的 SearchPage JSON（`initialData.searchPage.result.items`），只留 `itemStatus` 為 `Available`，價格取 `itemPrice.min`，商品網址去掉 `?s-id=`。廣告商品照常列出。走 `FETCH_PROXY_URL`，Worker 不通時退回直連 |
| 露天 | 有抓到商品（最多 24 筆） | 兩段 API：先 `rtapi.ruten.com.tw/api/search/v3/.../core/prod` 取商品編號，再 `/api/prod/v2/.../prod?id=` 取名稱、價格、庫存。圖片網址是 `https://gcs.rimg.com.tw` 加 `Image`，商品頁是 `https://www.ruten.com.tw/item/<編號>/`。庫存為 0 與非直購商品不列出。走 `FETCH_PROXY_URL`，Worker 不通時退回直連 |

沒有接上的店，以及原因：

- 博客來：首頁與搜尋都回 403。
- 家樂福線上購物：這台機器上 `carrefour.com.tw` 被轉到萬家福，不是家樂福的商品搜尋。
- 燦坤：找到的搜尋網址回到首頁錯誤頁，沒有商品清單。
- 全國電子：搜尋網址沒有回商品資料。
- friDay購物：搜尋頁是空殼，沒有商品。
- 康是美、屈臣氏：頁面或 API 被擋，沒有可解析的搜尋結果。
- 全聯官網 `shop.pxmart.com.tw` 回 403；實際接的是全聯全電商（PX Go / pxbox）。
- 誠品：搜尋頁被 Cloudflare 擋下，沒有可解析的商品，所以沒有接上。

蝦皮在 Cloudflare 的出口 IP 上可能和這台機器不一樣。

## 風險

- 這些平台的使用條款多半不允許自動抓搜尋結果。這一版量很小、有快取。蝦皮與酷澎的外出連結走官方分潤轉址，momo、Yahoo 奇摩、金石堂、樂天走通路王 Deep Link，其他店（PChome、全聯、三民、東森、露天）沒有聯盟參數。仍可能違反對方條款，也可能隨時被擋。
- momo、Yahoo 是解析網頁，版面一改就會變成「暫時無法取得」。PChome 與酷澎走 JSON。酷澎用 Partners Open API，金鑰放在 Pages secrets，不會寫進紀錄。PChome 沒有正式對外匯的保證。
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

聯盟參數只准加在 `shared/affiliate.ts` 的 `applyAffiliate`。除了蝦皮、酷澎與通路王的四家店以外，外出網址不會被改寫。蝦皮商品與「前往搜尋」連結會改成 `https://s.shopee.tw/an_redir`，`affiliate_id` 預設 `16330620037`，可用環境變數 `SHOPEE_AFFILIATE_ID` 覆寫，`sub_id` 是 `bibisaru`。酷澎的「前往搜尋」改成 `https://link.tw.coupang.com/re2/AFFKOLSRP`，`lptag` 預設 `AF6766993`，可用環境變數 `COUPANG_AFFILIATE_ID` 覆寫，`pageKey` 是原本的關鍵字，不加 `traceid`。商品清單改打 Partners Open API（`COUPANG_ACCESS_KEY`、`COUPANG_SECRET_KEY`，Pages secrets）。API 回的 `productUrl` 已是分潤連結，原樣使用。金鑰缺或 API 失敗時不抓 HTML，改顯示「暫時無法取得」和上面的分潤搜尋連結。

通路王 Deep Link：momo、Yahoo 奇摩購物中心（`tw.buy.yahoo.com`）、金石堂、樂天的商品連結與「前往搜尋」、「搜尋同款」等訪客點擊的外出連結，會改成 `https://product.mchannles.com/redirect_wa.php?k=<K>&uid1=bibisaru&tourl=<原網址 encodeURIComponent>`。網域比對含子網域，已經是 `product.mchannles.com` 的連結不會再包一次。`K`（活動編號 `2IsZi`，不是密鑰）預設寫在 `shared/affiliate.ts`，可用環境變數 `ICHANNELS_K` 覆寫。伺服器抓資料用的 `rawSearchUrl` 與原始商品網址永遠不包轉址。單元測試會鎖住這些規則。

Coupang Open API enabled

US fetch proxy enabled

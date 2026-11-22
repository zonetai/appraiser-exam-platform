# 不動產估價師考試學習平台

給準備「專門職業及技術人員高等考試不動產估價師考試」考生的自學網站：歷年考題、補習班解題要點、法規條文、政策與修法動態、系統猜題、計時模擬考、申論自評、讀書計畫與學習紀錄。

零外部套件：Node 22.13+（內建 `node:sqlite`）＋原生 HTML/JS。抓取考選部試題需 Python 3 與 `pypdf`。

## 快速開始

```bash
npm run init      # 建立 db/exam.sqlite 並匯入 db/seed/*.json
npm run build     # 匯出 public/data/*.json（網站實際讀的資料）
npm start         # http://localhost:3000
```

改了 `db/seed/*.json` 之後重跑 `npm run init` 與 `npm run build`。

## 架構與部署

網站是**純靜態**的：`public/` 整個資料夾就是成品，瀏覽器讀 `public/data/db.json`（題庫、政策、猜題…）與 `public/data/laws/*.json`（條文），學習紀錄、收藏、筆記、自撰解答存在**各自瀏覽器的 localStorage**，多人使用互不影響；「我的學習」頁可匯出／匯入 JSON 備份。

部署只要把 `public/` 放到任何靜態主機：
- **Netlify Drop**（最簡單）：登入 https://app.netlify.com/drop ，把 `public` 資料夾或 `估價師考試學習平台_靜態網站.zip` 拖進去，幾秒後得到網址；可在 Site settings 改自訂網域。
- **Cloudflare Pages**：Workers & Pages → Create → Upload assets，上傳 `public`。
- **GitHub Pages（本專案採用）**：repo 為 https://github.com/zonetai/appraiser-exam-platform ，`gh-pages` 分支只放 `public` 的內容，Pages 從該分支根目錄發布。更新流程：

  ```bash
  npm run init && npm run build
  git add -A && git commit -m "更新題庫"
  git push origin main
  npm run deploy        # = git subtree push --prefix public origin gh-pages
  ```
- 自有主機：任何 nginx／Apache／IIS 靜態目錄皆可，不需 Node。

`server.js` 只是本機預覽用的靜態檔案伺服器（同時保留一套 `/api` 端點，網站介面已不使用）。

## 功能對照補習班做法

| 網站功能 | 參考的補習班／考生做法 |
|---|---|
| 歷年題庫依「考點」標籤分類、年度 × 考點熱度圖 | 高點民法七種題型、公職王出題軌跡、心得「每年整理出題法條頻率」 |
| 題目頁：計時、作答區、五項自評量表（題意／法條／架構／計算／結論） | 公職王【解題關鍵→破題→法條→命中→擬答】格式、高點申論批改 |
| 多來源參考答案分頁（高點、公職王、自撰），附原始連結 | 高點歷屆高分詳解 PDF、公職王考後解答 |
| 模擬考：依考科時間（實務 4 小時）抽不同考點題目，倒數、交卷自評 | 高點模考線上測、考生「每週一科模擬考」 |
| 猜題：出題頻率 × 週期 × 近兩年政策熱度 × 名師點名 | 各補習班目前皆無估價師公開猜題（市場空缺） |
| 政策動態時間軸，每則附「可能考點」並自動對應考點 | 高點每週考點專欄、心得「法規變更是命題關鍵」 |
| 法規庫：全國法規資料庫抓取之完整條文，標示歷年考過條號 | 曾榮耀法條口訣、許文昌小法典 |
| 讀書計畫模板（24 週正規→題庫→總複習、12 週在職衝刺、4 週總複習） | 補習班班別序列、心得「以戰養戰」路線 |
| 我的學習：各科進度、弱點考點、每日練習量 | 公職王雷達能力指標、錯題本 |

## 資料來源與擴充

所有資料在 `db/seed/*.json`，修改後執行 `npm run init`。

| 檔案 | 內容 | 來源 |
|---|---|---|
| `subjects.json` | 七科名稱、時間、代號 | 考試規則第 6 條、考選部日程表 |
| `topics.json` | 各科考點與自動標註關鍵字 | 本站整理（可自行增修） |
| `questions.json` | 人工核對過的題目（112–114 年全科） | 考選部考畢試題 PDF 逐字抄錄 |
| `questions.moex.json` | 腳本自動切題（103–115 年），`verified:false` | `npm run fetch:moex` |
| `answers.json` | 解題要點（摘要＋來源連結） | 高點 114／112 詳解、本站自撰 |
| `laws.json` | 28 部法規全文條文 | `node scripts/fetch-laws.js`（law.moj.gov.tw） |
| `policies.json` | 2023–2026 修法、公報、市場政策 | 全國法規資料庫沿革、全聯會法令專區、央行、內政部 |
| `resources.json` | 公開資料來源與 API 說明 | 本站整理 |
| `cram_schools.json` | 補習班班別、教法、教材、價格、評價 | 各補習班官網、PTT／Dcard／部落格心得 |
| `predictions.json` | 人工／名師式猜題與理由 | 本站依研究整理 |
| `exam_stats.json` | 101–115 年報考／到考／及格 | 考選部統計 PDF、公職王彙整 |
| `study_plans.json` | 讀書計畫模板 | 本站整理 |

### 抓取考選部試題

```bash
npm run fetch:moex                  # 預設 110–115 年
node scripts/fetch-moex.js 103 115  # 指定年度範圍
node scripts/fetch-moex.js 102 --code=102140   # 自動找不到考試代碑時手動指定
```

URL 規則（114 年實測）：`https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?t=Q&code=114130&c=905&s=0306&q=1`。
考試代碼末三碼：103–105 為 130、106–112 為 140、113–115 為 130；102 年以前腳本未找到，請自考選部「考畢試題查詢」確認後以 `--code=` 指定。
PDF 下載至 `data/moex/<年>/`，再由 `scripts/parse_moex.py`（pypdf）切題寫入 `db/seed/questions.moex.json`。切題結果請在網站核對後，於 seed 中將 `verified` 改為 `true`；人工版 `questions.json` 會覆蓋自動版。

安裝 pypdf：`py -3 -m pip install pypdf`。

### 抓取法規條文

```bash
node scripts/fetch-laws.js                 # 更新 laws.json 中所有法規
node scripts/fetch-laws.js 不動產估價技術規則
```

新增法規：在 `laws.json` 加一筆 `{ "name": "...", "pcode": "...", "category": "..." }` 後執行。`exam_note` 欄位可對條文加考點提示，重抓時會保留。

## API

`GET /api/overview`、`/api/subjects`、`/api/topics?subject=`、`/api/questions?year=&subject=&topic=&q=&page=`、`/api/questions/:id`、`/api/heatmap?subject=`、`/api/predictions?subject=`、`/api/mock?subject=&n=`、`/api/policies?subject=&category=&since=`、`/api/laws`、`/api/laws/:id`、`/api/resources`、`/api/cram-schools`、`/api/study-plans`、`/api/progress`、`/api/search?q=`。
`POST /api/attempts`、`/api/bookmarks`、`/api/notes`、`/api/answers`、`/api/question-topics`。

## 已知限制與版權

- 考選部不公布申論題參考答案；補習班詳解為各機構著作，本站只收「解題要點」摘要並附原始連結，商業使用請取得授權。
- 自動切題會遺失圖表（如 114 年實務第二題示意圖）與部分利率因子表，請以考選部原卷為準。
- 102 年以前試題需手動指定考試代碼或自考選部下載後補登。
- 全聯會網站僅 http，公報 PDF 載有「未經同意不得重製」聲明，本站僅連結。
- 學習紀錄為單機版（無帳號），存在 `db/exam.sqlite`。

## 得分要點與自動批改

每題的「得分要點」放在 `db/seed/rubrics/<科目代碼>.json`（theory、practice、economics、investment、law_civil、law_land），為本站依現行法規與通說撰寫的原創評分依據，格式見各檔與 `scripts/init-db.js`：

- `points[]`：得分點（`title`、`weight` 合計 100、`keywords` 詞組，以 `|` 分隔同義寫法、`min_hits`）。
- `laws[]`：應引用法條；`answers[]`：計算題參考數值（含容許誤差）；`outline`、`figure`、`summary`、`note`。
- `sources[]`：該題的補習班解答原始連結。另可在 `db/seed/answer_sources.json` 以「年度＋科目」或「年度全科」批次掛連結。

**自動批改（內建）** 在瀏覽器執行（`public/grader.js`），不需伺服器：

| 項目 | 有應引法條 | 無應引法條 |
|---|---|---|
| 得分要點涵蓋（計算題含數值比對 45%） | 70% | 80% |
| 法條引用（條號＋法規名稱） | 12% | — |
| 架構（小標數 ≥ 子問數、結論句） | 10% | 12% |
| 篇幅（每分約 24 字；計算題 12 字） | 8% | 8% |

只列關鍵詞而無論述會折減。它檢查「有沒有寫到」，無法判斷論述對錯，請當檢核表使用。

**AI 批改（選用）**：`supabase/functions/grade/index.ts` 是 Supabase Edge Function，收到題目、得分要點與作答後呼叫 Claude API 逐點給分並寫評語。

```bash
supabase functions deploy grade --no-verify-jwt --project-ref <專案代碼>
supabase secrets set ANTHROPIC_API_KEY=<金鑰> --project-ref <專案代碼>
```

部署後把函式網址（`https://<專案代碼>.supabase.co/functions/v1/grade`）填進 `public/config.js` 的 `aiEndpoint` 再重新部署網站，題目頁就會出現「AI 批改」按鈕。注意事項：

- 金鑰只存在 Supabase secrets，不進前端。預設模型 `claude-opus-5-5`（可用 `GRADER_MODEL` 覆寫），每次批改約輸入 3–5 千、輸出 2–4 千 token。
- 這是公開端點，任何人都能觸發而產生費用。函式內建每 IP 每小時 12 次的限流（`HOURLY_LIMIT_PER_IP`）與來源網域限制（`ALLOWED_ORIGINS`），但請務必在 Anthropic Console 設定每月用量上限。
- 未啟用伺服器端 refusal fallback；模型拒答時前端會顯示錯誤訊息。

### 補習班解答連結與校準（`db/seed/answer_sources.json`）

- 高點／來勝：103–115 年六科各一份公開 PDF（`https://news.get.com.tw/File/News/<id>.pdf`），共 78 份。
- 公職王：69 份擬答採檔案直連（站內下載按鈕需登入會員；直連為站方決定採用），另 6 份連歷屆試題列表頁。
- 網站只放連結，不轉載解答內容。
- 校準：`node work/tools/dl_answers.cjs` 下載上述 PDF 至 `work/answers/`（不進版控），`py -3 -I work/tools/extract.py work/answers/pdf work/answers/txt` 轉文字（設有禁止複製保護的 PDF 不抽取），`node work/tools/calib.cjs` 以解答文字試跑批改引擎，列出得分要點涵蓋偏低或計算值不符的題目供人工檢視。`work/` 整個目錄已列入 `.gitignore`。

## 最新政策動態：價值島每日觀測

「政策動態」頁上方與首頁的最新快訊，來自事務所製作的[價值島](https://zonetai.com/value-isle/daily.html)（repo：zonetai/value-isle）。訪客開啟頁面時直接讀取它的 `assets/daily.js`，價值島每日更新，本站不必重新部署就會跟著更新。

- 預設顯示「政策氣候」層，可切換個別條件、市場潮位、國際海象；候選人政見預設收起。
- 讀不到資料時只顯示前往價值島的連結，不影響其他功能。
- 資料網址可在 `public/config.js` 以 `isleDataUrl` 覆寫。
- 下方的「修法與考點整理」仍由 `db/seed/policies.json` 維護，法規修正以這一區與原始條文為準。

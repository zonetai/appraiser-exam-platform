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

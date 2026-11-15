-- 不動產估價師考試學習平台 資料庫結構
-- SQLite，由 scripts/init-db.js 建立。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 考科
CREATE TABLE IF NOT EXISTS subjects (
  id          INTEGER PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,        -- 短代號，例如 theory / practice
  name        TEXT NOT NULL,               -- 考選部正式科目名稱
  exam_type   TEXT NOT NULL,               -- 申論 / 測驗 / 混合
  duration_min INTEGER,                    -- 考試時間（分）
  sort_order  INTEGER DEFAULT 0,
  description TEXT
);

-- 考點（主題）樹
CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id),
  parent_id   INTEGER REFERENCES topics(id),
  name        TEXT NOT NULL,
  keywords    TEXT,                        -- 以逗號分隔，供自動標註
  description TEXT,
  UNIQUE(subject_id, name)
);

-- 歷年試題
CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY,
  year         INTEGER NOT NULL,           -- 民國年
  subject_id   INTEGER NOT NULL REFERENCES subjects(id),
  exam_type    TEXT NOT NULL DEFAULT '申論', -- 申論 / 測驗
  question_no  INTEGER NOT NULL,
  score        INTEGER,
  text         TEXT NOT NULL,
  options      TEXT,                       -- 測驗題選項 JSON
  official_answer TEXT,                    -- 測驗題考選部公布答案
  source_url   TEXT,
  verified     INTEGER DEFAULT 1,          -- 1=已核對原始試題 0=待核對
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(year, subject_id, exam_type, question_no)
);

CREATE TABLE IF NOT EXISTS question_topics (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, topic_id)
);

-- 參考答案（補習班、名師、自撰）
CREATE TABLE IF NOT EXISTS answers (
  id           INTEGER PRIMARY KEY,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_name  TEXT NOT NULL,              -- 高點 / 志光 / 千華 / 自撰 ...
  source_url   TEXT,
  author       TEXT,
  answer_type  TEXT NOT NULL DEFAULT 'outline', -- full / outline / link
  content      TEXT,                       -- Markdown
  license_note TEXT,                       -- 版權說明
  created_at   TEXT DEFAULT (datetime('now'))
);

-- 法規
CREATE TABLE IF NOT EXISTS laws (
  id           INTEGER PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  short_name   TEXT,
  pcode        TEXT,                       -- 全國法規資料庫法規代碼
  url          TEXT,
  category     TEXT,                       -- 估價 / 土地 / 民法 / 都更 / 稅 ...
  last_amended TEXT,
  note         TEXT
);

CREATE TABLE IF NOT EXISTS law_articles (
  id         INTEGER PRIMARY KEY,
  law_id     INTEGER NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
  article_no TEXT NOT NULL,
  title      TEXT,
  text       TEXT NOT NULL,
  exam_note  TEXT,                         -- 考點提示
  UNIQUE(law_id, article_no)
);

CREATE TABLE IF NOT EXISTS question_laws (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  law_id      INTEGER NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
  article_no  TEXT,
  PRIMARY KEY (question_id, law_id, article_no)
);

-- 政策與修法動態
CREATE TABLE IF NOT EXISTS policies (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,               -- YYYY-MM-DD 或 YYYY-MM
  title       TEXT NOT NULL,
  summary     TEXT,
  exam_angle  TEXT,                        -- 可能考點
  source_url  TEXT,
  source_name TEXT,
  category    TEXT,                        -- 修法 / 公報 / 市場政策 / 函釋 ...
  verified    INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_subjects (
  policy_id  INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (policy_id, subject_id)
);

CREATE TABLE IF NOT EXISTS policy_topics (
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (policy_id, topic_id)
);

-- 公開資料來源
CREATE TABLE IF NOT EXISTS resources (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  url              TEXT,
  category         TEXT,
  content          TEXT,
  api_or_opendata  TEXT,
  update_frequency TEXT,
  use_for_students TEXT
);

-- 補習班
CREATE TABLE IF NOT EXISTS cram_schools (
  id        INTEGER PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,
  url       TEXT,
  courses   TEXT,   -- JSON 陣列：班別
  methods   TEXT,   -- JSON 陣列：教學方式
  materials TEXT,   -- JSON 陣列：教材與免費資源
  pricing   TEXT,
  reviews   TEXT,
  notes     TEXT
);

-- 猜題（人工/名師/系統）
CREATE TABLE IF NOT EXISTS predictions (
  id         INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  topic_id   INTEGER REFERENCES topics(id),
  title      TEXT NOT NULL,
  rationale  TEXT,
  weight     REAL DEFAULT 1.0,            -- 0~5
  basis      TEXT,                         -- frequency / policy / instructor / cycle
  target_year INTEGER,
  sources    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 考試統計（報考、到考、及格）
CREATE TABLE IF NOT EXISTS exam_stats (
  year        INTEGER PRIMARY KEY,
  applicants  INTEGER,
  attendees   INTEGER,
  passed      INTEGER,
  pass_rate   REAL,
  note        TEXT
);

-- 讀書計畫模板
CREATE TABLE IF NOT EXISTS study_plans (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  weeks   INTEGER,
  description TEXT,
  plan    TEXT NOT NULL   -- JSON：每週任務
);

-- 學習紀錄（單機版，無帳號）
CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  mode         TEXT DEFAULT 'practice',    -- practice / mock
  started_at   TEXT DEFAULT (datetime('now')),
  duration_sec INTEGER,
  self_score   INTEGER,                    -- 自評 0-100
  rubric       TEXT,                       -- JSON 自評細項
  answer_text  TEXT,                       -- 考生作答
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS bookmarks (
  question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  note        TEXT
);

CREATE TABLE IF NOT EXISTS user_notes (
  id         INTEGER PRIMARY KEY,
  ref_type   TEXT NOT NULL,                -- question / topic / law / policy
  ref_id     INTEGER NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_year ON questions(year);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_policies_date ON policies(date);
CREATE INDEX IF NOT EXISTS idx_attempts_q ON attempts(question_id);

-- 得分要點（自動批改用），每題一筆 JSON
CREATE TABLE IF NOT EXISTS rubrics (
  question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  data        TEXT NOT NULL
);

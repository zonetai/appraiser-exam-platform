// 把 SQLite 匯出成靜態 JSON（public/data/），供純靜態部署使用
// 用法：node scripts/export-static.js
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'exam.sqlite');
const OUT = path.join(ROOT, 'public', 'data');
if (!fs.existsSync(DB_PATH)) { console.error('找不到資料庫，請先 npm run init'); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'laws'), { recursive: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return s; } };

const subjects = all('SELECT * FROM subjects ORDER BY sort_order');
const topics = all('SELECT * FROM topics ORDER BY subject_id, name');
const qt = all('SELECT * FROM question_topics');
const ql = all('SELECT * FROM question_laws');
const answers = all('SELECT * FROM answers ORDER BY id');
const rubrics = Object.fromEntries(all('SELECT * FROM rubrics').map((r) => [r.question_id, parse(r.data)]));
const questions = all('SELECT * FROM questions ORDER BY year DESC, subject_id, exam_type, question_no').map((q) => ({
  ...q, options: parse(q.options), rubric: rubrics[q.id] || null,
  topic_ids: qt.filter((x) => x.question_id === q.id).map((x) => x.topic_id),
  laws: ql.filter((x) => x.question_id === q.id).map((x) => ({ law_id: x.law_id, article_no: x.article_no })),
  answers: answers.filter((a) => a.question_id === q.id),
}));
const ps = all('SELECT * FROM policy_subjects');
const pt = all('SELECT * FROM policy_topics');
const policies = all('SELECT * FROM policies ORDER BY date DESC').map((p) => ({
  ...p, subject_ids: ps.filter((x) => x.policy_id === p.id).map((x) => x.subject_id), topic_ids: pt.filter((x) => x.policy_id === p.id).map((x) => x.topic_id),
}));
const laws = all('SELECT * FROM laws ORDER BY category, name').map((l) => ({
  ...l, article_count: db.prepare('SELECT COUNT(*) AS n FROM law_articles WHERE law_id=?').get(l.id).n,
  question_count: ql.filter((x) => x.law_id === l.id).length,
}));
const articlesAll = [];
for (const l of laws) {
  const articles = all('SELECT id, article_no, title, text, exam_note FROM law_articles WHERE law_id=? ORDER BY CAST(article_no AS INTEGER), article_no', l.id);
  fs.writeFileSync(path.join(OUT, 'laws', `${l.id}.json`), JSON.stringify({ ...l, articles }));
  for (const a of articles) articlesAll.push({ id: a.id, law_id: l.id, law_name: l.name, article_no: a.article_no, title: a.title, text: a.text });
}
fs.writeFileSync(path.join(OUT, 'articles.json'), JSON.stringify(articlesAll));

const bundle = {
  generated_at: new Date().toISOString(),
  subjects, topics, questions, policies, laws,
  resources: all('SELECT * FROM resources ORDER BY category, name'),
  cram_schools: all('SELECT * FROM cram_schools ORDER BY name').map((c) => ({ ...c, courses: parse(c.courses) || [], methods: parse(c.methods) || [], materials: parse(c.materials) || [] })),
  predictions: all('SELECT * FROM predictions').map((p) => ({ ...p, sources: parse(p.sources) })),
  exam_stats: all('SELECT * FROM exam_stats ORDER BY year'),
  study_plans: all('SELECT * FROM study_plans').map((p) => ({ ...p, plan: parse(p.plan) || [] })),
};
fs.writeFileSync(path.join(OUT, 'db.json'), JSON.stringify(bundle));
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log(`已匯出 → ${OUT}\n  db.json ${size('db.json')}（題 ${questions.length}、政策 ${policies.length}、法規 ${laws.length}）\n  articles.json ${size('articles.json')}（條文 ${articlesAll.length}）\n  laws/*.json ${laws.length} 份`);
db.close();

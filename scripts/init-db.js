// 建立 SQLite 資料庫並匯入 db/seed/*.json
// 用法：node scripts/init-db.js [--reset]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'exam.sqlite');
const SEED_DIR = path.join(ROOT, 'db', 'seed');

if (process.argv.includes('--reset') && fs.existsSync(DB_PATH)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log('已刪除舊資料庫');
}

const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

function loadSeed(name) {
  const p = path.join(SEED_DIR, name);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [];
}

const j = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// ---------- subjects ----------
const subjects = loadSeed('subjects.json');
const insSubject = db.prepare(`INSERT INTO subjects (code,name,exam_type,duration_min,sort_order,description)
  VALUES (?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, exam_type=excluded.exam_type,
  duration_min=excluded.duration_min, sort_order=excluded.sort_order, description=excluded.description`);
for (const s of subjects) insSubject.run(s.code, s.name, s.exam_type || '申論', s.duration_min ?? null, s.sort_order ?? 0, s.description ?? null);

const subjectRows = db.prepare('SELECT id, code, name FROM subjects').all();
function subjectId(ref) {
  if (ref === undefined || ref === null) return null;
  if (typeof ref === 'number') return ref;
  const r = subjectRows.find((s) => s.code === ref || s.name === ref)
    || subjectRows.find((s) => ref.includes(s.name) || s.name.includes(ref));
  if (!r) throw new Error(`找不到考科：${ref}`);
  return r.id;
}

// ---------- topics ----------
const topics = loadSeed('topics.json');
const insTopic = db.prepare(`INSERT INTO topics (subject_id,parent_id,name,keywords,description) VALUES (?,?,?,?,?)
  ON CONFLICT(subject_id,name) DO UPDATE SET keywords=excluded.keywords, description=excluded.description, parent_id=excluded.parent_id`);
// 先插父層
for (const t of topics.filter((t) => !t.parent)) insTopic.run(subjectId(t.subject), null, t.name, j(t.keywords), t.description ?? null);
const topicIdByName = (sid, name) => db.prepare('SELECT id FROM topics WHERE subject_id=? AND name=?').get(sid, name)?.id ?? null;
for (const t of topics.filter((t) => t.parent)) {
  const sid = subjectId(t.subject);
  insTopic.run(sid, topicIdByName(sid, t.parent), t.name, j(t.keywords), t.description ?? null);
}
const allTopics = db.prepare('SELECT id, subject_id, name, keywords FROM topics').all();

function autoTag(subjectIdVal, text) {
  const hits = [];
  for (const t of allTopics.filter((t) => t.subject_id === subjectIdVal)) {
    const kws = (t.keywords || '').split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
    if (kws.some((k) => text.includes(k)) || text.includes(t.name)) hits.push(t.id);
  }
  return hits;
}

// ---------- laws ----------
const laws = loadSeed('laws.json');
const insLaw = db.prepare(`INSERT INTO laws (name,short_name,pcode,url,category,last_amended,note) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(name) DO UPDATE SET short_name=excluded.short_name, pcode=excluded.pcode, url=excluded.url,
  category=excluded.category, last_amended=excluded.last_amended, note=excluded.note`);
const insArticle = db.prepare(`INSERT INTO law_articles (law_id,article_no,title,text,exam_note) VALUES (?,?,?,?,?)
  ON CONFLICT(law_id,article_no) DO UPDATE SET title=excluded.title, text=excluded.text, exam_note=excluded.exam_note`);
for (const l of laws) {
  insLaw.run(l.name, l.short_name ?? null, l.pcode ?? null, l.url ?? null, l.category ?? null, l.last_amended ?? null, l.note ?? null);
  const lid = db.prepare('SELECT id FROM laws WHERE name=?').get(l.name).id;
  for (const a of l.articles || []) insArticle.run(lid, String(a.article_no), a.title ?? null, a.text, a.exam_note ?? null);
}
function lawId(ref) {
  const r = db.prepare('SELECT id FROM laws WHERE name=? OR short_name=?').get(ref, ref);
  return r?.id ?? null;
}

// ---------- questions ----------
// 先載入自動抓取的 questions.*.json，最後載入人工核對的 questions.json（同一題以人工版為準）
const questionFiles = fs.existsSync(SEED_DIR)
  ? fs.readdirSync(SEED_DIR).filter((f) => /^questions\..+\.json$/.test(f)).sort()
  : [];
const questions = [...questionFiles.flatMap((f) => loadSeed(f)), ...loadSeed('questions.json')];
const insQ = db.prepare(`INSERT INTO questions (year,subject_id,exam_type,question_no,score,text,options,official_answer,source_url,verified)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(year,subject_id,exam_type,question_no) DO UPDATE SET score=excluded.score, text=excluded.text,
  options=excluded.options, official_answer=excluded.official_answer, source_url=excluded.source_url, verified=excluded.verified`);
const insQT = db.prepare('INSERT OR IGNORE INTO question_topics (question_id,topic_id) VALUES (?,?)');
const insQL = db.prepare('INSERT OR IGNORE INTO question_laws (question_id,law_id,article_no) VALUES (?,?,?)');
let qCount = 0;
for (const q of questions) {
  const sid = subjectId(q.subject);
  const type = q.exam_type || '申論';
  insQ.run(q.year, sid, type, q.question_no, q.score ?? null, q.text, j(q.options), q.official_answer ?? null, q.source_url ?? null, q.verified === false ? 0 : 1);
  const qid = db.prepare('SELECT id FROM questions WHERE year=? AND subject_id=? AND exam_type=? AND question_no=?').get(q.year, sid, type, q.question_no).id;
  const topicIds = new Set();
  for (const name of q.topics || []) {
    const tid = topicIdByName(sid, name);
    if (tid) topicIds.add(tid);
  }
  for (const tid of autoTag(sid, q.text)) topicIds.add(tid);
  for (const tid of topicIds) insQT.run(qid, tid);
  for (const l of q.laws || []) {
    const lid = lawId(l.law);
    if (lid) insQL.run(qid, lid, l.article ?? '');
  }
  qCount++;
}

// ---------- answers ----------
const answers = loadSeed('answers.json');
db.exec('DELETE FROM answers');
const insA = db.prepare(`INSERT INTO answers (question_id,source_name,source_url,author,answer_type,content,license_note) VALUES (?,?,?,?,?,?,?)`);
let aCount = 0;
for (const a of answers) {
  const sid = subjectId(a.subject);
  const q = db.prepare('SELECT id FROM questions WHERE year=? AND subject_id=? AND exam_type=? AND question_no=?')
    .get(a.year, sid, a.exam_type || '申論', a.question_no);
  if (!q) { console.warn(`答案找不到對應題目：${a.year} ${a.subject} 第${a.question_no}題`); continue; }
  insA.run(q.id, a.source_name, a.source_url ?? null, a.author ?? null, a.answer_type || 'outline', a.content ?? null, a.license_note ?? null);
  aCount++;
}

// ---------- policies ----------
const policies = loadSeed('policies.json');
db.exec('DELETE FROM policies');
const insP = db.prepare(`INSERT INTO policies (date,title,summary,exam_angle,source_url,source_name,category,verified) VALUES (?,?,?,?,?,?,?,?)`);
const insPS = db.prepare('INSERT OR IGNORE INTO policy_subjects (policy_id,subject_id) VALUES (?,?)');
const insPT = db.prepare('INSERT OR IGNORE INTO policy_topics (policy_id,topic_id) VALUES (?,?)');
for (const p of policies) {
  insP.run(p.date, p.title, p.summary ?? null, p.exam_angle ?? null, p.source_url ?? null, p.source_name ?? null, p.category ?? null, p.verified === false || p.unverified === true ? 0 : 1);
  const pid = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  for (const s of p.subjects || []) {
    try { insPS.run(pid, subjectId(s)); } catch { /* 忽略無法對應的科目 */ }
  }
  // 政策自動對應考點：依關鍵字
  const matchedSubjects = db.prepare('SELECT subject_id FROM policy_subjects WHERE policy_id=?').all(pid).map((r) => r.subject_id);
  for (const sid of matchedSubjects) for (const tid of autoTag(sid, `${p.title} ${p.summary || ''} ${p.exam_angle || ''}`)) insPT.run(pid, tid);
  for (const name of p.topics || []) {
    for (const sid of matchedSubjects) { const tid = topicIdByName(sid, name); if (tid) insPT.run(pid, tid); }
  }
}

// ---------- resources ----------
const resources = loadSeed('resources.json');
db.exec('DELETE FROM resources');
const insR = db.prepare(`INSERT INTO resources (name,url,category,content,api_or_opendata,update_frequency,use_for_students) VALUES (?,?,?,?,?,?,?)`);
for (const r of resources) insR.run(r.name, r.url ?? null, r.category ?? null, r.content ?? null, r.api_or_opendata ?? null, r.update_frequency ?? null, r.use_for_students ?? null);

// ---------- cram schools ----------
const schools = loadSeed('cram_schools.json');
db.exec('DELETE FROM cram_schools');
const insC = db.prepare(`INSERT INTO cram_schools (name,url,courses,methods,materials,pricing,reviews,notes) VALUES (?,?,?,?,?,?,?,?)`);
for (const c of schools) insC.run(c.name, c.url ?? null, j(c.courses), j(c.methods), j(c.materials), c.pricing ?? null, c.reviews ?? null, c.notes ?? null);

// ---------- predictions ----------
const preds = loadSeed('predictions.json');
db.exec('DELETE FROM predictions');
const insPr = db.prepare(`INSERT INTO predictions (subject_id,topic_id,title,rationale,weight,basis,target_year,sources) VALUES (?,?,?,?,?,?,?,?)`);
for (const p of preds) {
  const sid = subjectId(p.subject);
  insPr.run(sid, p.topic ? topicIdByName(sid, p.topic) : null, p.title, p.rationale ?? null, p.weight ?? 1, p.basis ?? 'instructor', p.target_year ?? null, j(p.sources));
}

// ---------- exam stats ----------
const stats = loadSeed('exam_stats.json');
const insS = db.prepare(`INSERT INTO exam_stats (year,applicants,attendees,passed,pass_rate,note) VALUES (?,?,?,?,?,?)
  ON CONFLICT(year) DO UPDATE SET applicants=excluded.applicants, attendees=excluded.attendees, passed=excluded.passed, pass_rate=excluded.pass_rate, note=excluded.note`);
for (const s of stats) insS.run(s.year, s.applicants ?? null, s.attendees ?? null, s.passed ?? null, s.pass_rate ?? null, s.note ?? null);

// ---------- study plans ----------
const plans = loadSeed('study_plans.json');
db.exec('DELETE FROM study_plans');
const insSP = db.prepare('INSERT INTO study_plans (name,weeks,description,plan) VALUES (?,?,?,?)');
for (const p of plans) insSP.run(p.name, p.weeks ?? null, p.description ?? null, j(p.plan));

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`資料庫：${DB_PATH}`);
console.log(`考科 ${count('subjects')}、考點 ${count('topics')}、試題 ${count('questions')}（本次處理 ${qCount}）、參考答案 ${aCount}、法規 ${count('laws')}（條文 ${count('law_articles')}）、政策 ${count('policies')}、資料來源 ${count('resources')}、補習班 ${count('cram_schools')}、猜題 ${count('predictions')}、統計 ${count('exam_stats')}、讀書計畫 ${count('study_plans')}`);
db.close();

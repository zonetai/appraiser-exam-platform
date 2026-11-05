// 不動產估價師考試學習平台 — 伺服器（Node 22.13+，無外部套件）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(__dirname, 'db', 'exam.sqlite');
const PORT = Number(process.env.PORT) || 3000;

if (!fs.existsSync(DB_PATH)) {
  console.error('找不到資料庫，請先執行：npm run init');
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const parseJSON = (s, fallback = null) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const num = (v, d = null) => (v === undefined || v === '' || v === null ? d : Number(v));

// ---------- 查詢輔助 ----------
function questionWithDetails(id) {
  const q = db.prepare(`SELECT q.*, s.name AS subject_name, s.code AS subject_code FROM questions q JOIN subjects s ON s.id=q.subject_id WHERE q.id=?`).get(id);
  if (!q) return null;
  q.options = parseJSON(q.options, null);
  q.topics = db.prepare(`SELECT t.id, t.name FROM question_topics qt JOIN topics t ON t.id=qt.topic_id WHERE qt.question_id=? ORDER BY t.name`).all(id);
  q.answers = db.prepare(`SELECT * FROM answers WHERE question_id=? ORDER BY CASE answer_type WHEN 'full' THEN 0 WHEN 'outline' THEN 1 ELSE 2 END, source_name`).all(id);
  q.laws = db.prepare(`SELECT l.id, l.name, l.short_name, l.url, ql.article_no FROM question_laws ql JOIN laws l ON l.id=ql.law_id WHERE ql.question_id=?`).all(id);
  const topicIds = q.topics.map((t) => t.id);
  q.related_policies = topicIds.length
    ? db.prepare(`SELECT DISTINCT p.id, p.date, p.title, p.exam_angle FROM policy_topics pt JOIN policies p ON p.id=pt.policy_id WHERE pt.topic_id IN (${topicIds.map(() => '?').join(',')}) ORDER BY p.date DESC LIMIT 8`).all(...topicIds)
    : [];
  q.similar = topicIds.length
    ? db.prepare(`SELECT DISTINCT q2.id, q2.year, q2.question_no, substr(q2.text,1,80) AS snippet, s.name AS subject_name FROM question_topics qt JOIN questions q2 ON q2.id=qt.question_id JOIN subjects s ON s.id=q2.subject_id WHERE qt.topic_id IN (${topicIds.map(() => '?').join(',')}) AND q2.id<>? ORDER BY q2.year DESC LIMIT 10`).all(...topicIds, id)
    : [];
  q.bookmarked = !!db.prepare('SELECT 1 FROM bookmarks WHERE question_id=?').get(id);
  q.attempts = db.prepare('SELECT id, mode, started_at, duration_sec, self_score, notes FROM attempts WHERE question_id=? ORDER BY started_at DESC LIMIT 10').all(id);
  q.notes = db.prepare(`SELECT * FROM user_notes WHERE ref_type='question' AND ref_id=? ORDER BY created_at DESC`).all(id);
  return q;
}

function listQuestions(params) {
  const where = []; const args = [];
  if (params.get('year')) { where.push('q.year=?'); args.push(num(params.get('year'))); }
  if (params.get('subject')) { where.push('(s.code=? OR s.id=?)'); args.push(params.get('subject'), num(params.get('subject'), -1)); }
  if (params.get('type')) { where.push('q.exam_type=?'); args.push(params.get('type')); }
  if (params.get('topic')) { where.push('q.id IN (SELECT question_id FROM question_topics WHERE topic_id=?)'); args.push(num(params.get('topic'))); }
  if (params.get('q')) { where.push('q.text LIKE ?'); args.push(`%${params.get('q')}%`); }
  if (params.get('bookmarked') === '1') where.push('q.id IN (SELECT question_id FROM bookmarks)');
  if (params.get('untagged') === '1') where.push('q.id NOT IN (SELECT question_id FROM question_topics)');
  if (params.get('weak') === '1') where.push('q.id IN (SELECT question_id FROM attempts GROUP BY question_id HAVING AVG(self_score) < 60)');
  const page = Math.max(1, num(params.get('page'), 1));
  const size = Math.min(100, Math.max(1, num(params.get('size'), 20)));
  const sql = `FROM questions q JOIN subjects s ON s.id=q.subject_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
  const rows = db.prepare(`SELECT q.id, q.year, q.exam_type, q.question_no, q.score, q.text, q.verified, s.name AS subject_name, s.code AS subject_code,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) AS answer_count,
      (SELECT GROUP_CONCAT(t.name, '、') FROM question_topics qt JOIN topics t ON t.id=qt.topic_id WHERE qt.question_id=q.id) AS topic_names,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.question_id=q.id) AS bookmarked,
      (SELECT AVG(self_score) FROM attempts at WHERE at.question_id=q.id) AS avg_score
    ${sql} ORDER BY q.year DESC, s.sort_order, q.exam_type, q.question_no LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  return { total, page, size, items: rows };
}

function heatmap(subjectCode) {
  const s = db.prepare('SELECT id, name FROM subjects WHERE code=? OR id=?').get(subjectCode, num(subjectCode, -1));
  if (!s) return null;
  const years = db.prepare('SELECT DISTINCT year FROM questions WHERE subject_id=? ORDER BY year').all(s.id).map((r) => r.year);
  const topics = db.prepare(`SELECT t.id, t.name, t.parent_id, (SELECT COUNT(*) FROM question_topics qt WHERE qt.topic_id=t.id) AS total
    FROM topics t WHERE t.subject_id=? ORDER BY total DESC, t.name`).all(s.id);
  const cells = db.prepare(`SELECT qt.topic_id, q.year, COUNT(*) AS n, SUM(COALESCE(q.score,0)) AS score FROM question_topics qt JOIN questions q ON q.id=qt.question_id
    WHERE q.subject_id=? GROUP BY qt.topic_id, q.year`).all(s.id);
  const untagged = db.prepare('SELECT COUNT(*) AS n FROM questions q WHERE q.subject_id=? AND q.id NOT IN (SELECT question_id FROM question_topics)').get(s.id).n;
  return { subject: s, years, topics, cells, untagged };
}

// 系統猜題：出題頻率 × 近期趨勢 × 政策熱度 × 週期 + 人工猜題
function predictions(subjectCode, targetYear) {
  const s = db.prepare('SELECT id, name, code FROM subjects WHERE code=? OR id=?').get(subjectCode, num(subjectCode, -1));
  if (!s) return null;
  const latest = db.prepare('SELECT MAX(year) AS y FROM questions WHERE subject_id=?').get(s.id).y || 114;
  const target = targetYear || latest + 1;
  const topics = db.prepare('SELECT id, name, description FROM topics WHERE subject_id=?').all(s.id);
  const qRows = db.prepare(`SELECT qt.topic_id, q.year, q.score FROM question_topics qt JOIN questions q ON q.id=qt.question_id WHERE q.subject_id=?`).all(s.id);
  const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const since = twoYearsAgo.toISOString().slice(0, 7);
  const pRows = db.prepare(`SELECT pt.topic_id, p.id, p.title, p.date FROM policy_topics pt JOIN policies p ON p.id=pt.policy_id WHERE p.date >= ?`).all(since);
  const manual = db.prepare('SELECT * FROM predictions WHERE subject_id=?').all(s.id);

  const out = topics.map((t) => {
    const qs = qRows.filter((r) => r.topic_id === t.id);
    const total = qs.length;
    const recent = qs.reduce((acc, r) => acc + Math.pow(0.8, Math.max(0, latest - r.year)), 0);
    const lastYear = qs.length ? Math.max(...qs.map((r) => r.year)) : null;
    const gap = lastYear ? target - lastYear : null;
    const pols = pRows.filter((r) => r.topic_id === t.id);
    const man = manual.filter((m) => m.topic_id === t.id);
    const manualWeight = man.reduce((a, m) => a + (m.weight || 1), 0);
    const cycleBoost = total >= 3 && gap !== null && gap >= 2 && gap <= 4 ? 1.2 : 0;
    const policyBoost = Math.min(3, pols.length * 0.9);
    const score = recent * 1.0 + Math.min(3, total * 0.15) + cycleBoost + policyBoost + manualWeight;
    return {
      topic_id: t.id, topic: t.name, description: t.description, score: Math.round(score * 100) / 100,
      total, recent: Math.round(recent * 100) / 100, last_year: lastYear, gap, cycle_boost: cycleBoost, policy_boost: policyBoost,
      policies: pols.slice(0, 5).map((p) => ({ id: p.id, title: p.title, date: p.date })),
      manual: man.map((m) => ({ id: m.id, title: m.title, rationale: m.rationale, weight: m.weight, basis: m.basis, sources: parseJSON(m.sources, m.sources) })),
    };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const unlinkedManual = manual.filter((m) => !m.topic_id).map((m) => ({ id: m.id, title: m.title, rationale: m.rationale, weight: m.weight, basis: m.basis, sources: parseJSON(m.sources, m.sources) }));
  return { subject: s, latest_year: latest, target_year: target, items: out, unlinked_manual: unlinkedManual };
}

function mockExam(subjectCode, n) {
  const s = db.prepare('SELECT * FROM subjects WHERE code=? OR id=?').get(subjectCode, num(subjectCode, -1));
  if (!s) return null;
  const pool = db.prepare(`SELECT q.id, q.year, q.question_no, q.score, q.text FROM questions q WHERE q.subject_id=? AND q.exam_type='申論'`).all(s.id);
  const topicsOf = (id) => db.prepare('SELECT topic_id FROM question_topics WHERE question_id=?').all(id).map((r) => r.topic_id);
  const chosen = []; const used = new Set();
  const shuffled = pool.sort(() => Math.random() - 0.5);
  for (const q of shuffled) { // 盡量涵蓋不同考點
    const ts = topicsOf(q.id);
    if (ts.length && ts.every((t) => used.has(t))) continue;
    chosen.push(q); ts.forEach((t) => used.add(t));
    if (chosen.length >= n) break;
  }
  for (const q of shuffled) { if (chosen.length >= n) break; if (!chosen.includes(q)) chosen.push(q); }
  return { subject: s, duration_min: s.duration_min || 120, questions: chosen.map((q, i) => ({ ...q, order: i + 1, score: q.score || Math.round(100 / n) })) };
}

function overview() {
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  const years = db.prepare('SELECT DISTINCT year FROM questions ORDER BY year').all().map((r) => r.year);
  return {
    questions: g('SELECT COUNT(*) AS n FROM questions').n,
    answers: g('SELECT COUNT(*) AS n FROM answers').n,
    policies: g('SELECT COUNT(*) AS n FROM policies').n,
    laws: g('SELECT COUNT(*) AS n FROM laws').n,
    articles: g('SELECT COUNT(*) AS n FROM law_articles').n,
    topics: g('SELECT COUNT(*) AS n FROM topics').n,
    resources: g('SELECT COUNT(*) AS n FROM resources').n,
    schools: g('SELECT COUNT(*) AS n FROM cram_schools').n,
    years, year_min: years[0] ?? null, year_max: years.at(-1) ?? null,
    by_subject: db.prepare(`SELECT s.id, s.code, s.name, s.exam_type, s.duration_min, COUNT(q.id) AS questions, MIN(q.year) AS year_min, MAX(q.year) AS year_max,
       (SELECT COUNT(*) FROM topics t WHERE t.subject_id=s.id) AS topics FROM subjects s LEFT JOIN questions q ON q.subject_id=s.id GROUP BY s.id ORDER BY s.sort_order`).all(),
    attempts: g('SELECT COUNT(*) AS n, AVG(self_score) AS avg FROM attempts'),
    bookmarks: g('SELECT COUNT(*) AS n FROM bookmarks').n,
    recent_policies: db.prepare('SELECT id, date, title, category FROM policies ORDER BY date DESC LIMIT 6').all(),
    stats: db.prepare('SELECT * FROM exam_stats ORDER BY year').all(),
    coverage: db.prepare('SELECT year, s.code, COUNT(*) AS n FROM questions q JOIN subjects s ON s.id=q.subject_id GROUP BY year, s.code ORDER BY year').all(),
  };
}

function search(qstr) {
  const like = `%${qstr}%`;
  return {
    questions: db.prepare(`SELECT q.id, q.year, q.question_no, substr(q.text,1,120) AS snippet, s.name AS subject_name FROM questions q JOIN subjects s ON s.id=q.subject_id WHERE q.text LIKE ? ORDER BY q.year DESC LIMIT 20`).all(like),
    policies: db.prepare(`SELECT id, date, title, substr(summary,1,120) AS snippet FROM policies WHERE title LIKE ? OR summary LIKE ? OR exam_angle LIKE ? ORDER BY date DESC LIMIT 20`).all(like, like, like),
    articles: db.prepare(`SELECT a.id, a.law_id, l.name AS law_name, a.article_no, substr(a.text,1,120) AS snippet FROM law_articles a JOIN laws l ON l.id=a.law_id WHERE a.text LIKE ? OR a.title LIKE ? LIMIT 20`).all(like, like),
    topics: db.prepare(`SELECT t.id, t.name, s.name AS subject_name, s.code AS subject_code FROM topics t JOIN subjects s ON s.id=t.subject_id WHERE t.name LIKE ? OR t.keywords LIKE ? LIMIT 20`).all(like, like),
  };
}

function progress() {
  return {
    by_subject: db.prepare(`SELECT s.code, s.name, COUNT(DISTINCT a.question_id) AS practiced, COUNT(a.id) AS attempts, ROUND(AVG(a.self_score),1) AS avg_score,
        (SELECT COUNT(*) FROM questions q WHERE q.subject_id=s.id AND q.exam_type='申論') AS total
      FROM subjects s LEFT JOIN questions q ON q.subject_id=s.id LEFT JOIN attempts a ON a.question_id=q.id GROUP BY s.id ORDER BY s.sort_order`).all(),
    by_topic_weak: db.prepare(`SELECT t.id, t.name, s.name AS subject_name, ROUND(AVG(a.self_score),1) AS avg_score, COUNT(a.id) AS attempts
      FROM attempts a JOIN question_topics qt ON qt.question_id=a.question_id JOIN topics t ON t.id=qt.topic_id JOIN subjects s ON s.id=t.subject_id
      GROUP BY t.id HAVING COUNT(a.id)>=1 ORDER BY avg_score ASC LIMIT 15`).all(),
    recent: db.prepare(`SELECT a.*, q.year, q.question_no, substr(q.text,1,80) AS snippet, s.name AS subject_name FROM attempts a JOIN questions q ON q.id=a.question_id JOIN subjects s ON s.id=q.subject_id ORDER BY a.started_at DESC LIMIT 30`).all(),
    daily: db.prepare(`SELECT substr(started_at,1,10) AS day, COUNT(*) AS n, SUM(COALESCE(duration_sec,0)) AS seconds FROM attempts GROUP BY day ORDER BY day DESC LIMIT 60`).all(),
    bookmarks: db.prepare(`SELECT b.*, q.year, q.question_no, substr(q.text,1,80) AS snippet, s.name AS subject_name FROM bookmarks b JOIN questions q ON q.id=b.question_id JOIN subjects s ON s.id=q.subject_id ORDER BY b.created_at DESC`).all(),
  };
}

// ---------- 路由 ----------
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => resolve(parseJSON(data, {})));
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '');
  const sp = url.searchParams;
  const m = (re) => p.match(re);
  let r;
  if (req.method === 'GET') {
    if (p === '/overview') return send(res, 200, overview());
    if (p === '/subjects') return send(res, 200, db.prepare('SELECT * FROM subjects ORDER BY sort_order').all());
    if (p === '/topics') {
      const sid = sp.get('subject');
      const rows = sid
        ? db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM question_topics qt WHERE qt.topic_id=t.id) AS question_count FROM topics t JOIN subjects s ON s.id=t.subject_id WHERE s.code=? OR s.id=? ORDER BY question_count DESC, t.name`).all(sid, num(sid, -1))
        : db.prepare(`SELECT t.*, s.code AS subject_code, (SELECT COUNT(*) FROM question_topics qt WHERE qt.topic_id=t.id) AS question_count FROM topics t JOIN subjects s ON s.id=t.subject_id ORDER BY s.sort_order, question_count DESC`).all();
      return send(res, 200, rows);
    }
    if (p === '/questions') return send(res, 200, listQuestions(sp));
    if ((r = m(/^\/questions\/(\d+)$/))) { const q = questionWithDetails(Number(r[1])); return q ? send(res, 200, q) : send(res, 404, { error: 'not found' }); }
    if (p === '/years') return send(res, 200, db.prepare('SELECT year, COUNT(*) AS n FROM questions GROUP BY year ORDER BY year DESC').all());
    if (p === '/heatmap') { const h = heatmap(sp.get('subject')); return h ? send(res, 200, h) : send(res, 404, { error: 'subject not found' }); }
    if (p === '/predictions') { const pr = predictions(sp.get('subject'), num(sp.get('year'))); return pr ? send(res, 200, pr) : send(res, 404, { error: 'subject not found' }); }
    if (p === '/mock') { const mk = mockExam(sp.get('subject'), Math.min(10, Math.max(1, num(sp.get('n'), 4)))); return mk ? send(res, 200, mk) : send(res, 404, { error: 'subject not found' }); }
    if (p === '/policies') {
      const where = []; const args = [];
      if (sp.get('subject')) { where.push('p.id IN (SELECT ps.policy_id FROM policy_subjects ps JOIN subjects s ON s.id=ps.subject_id WHERE s.code=? OR s.id=?)'); args.push(sp.get('subject'), num(sp.get('subject'), -1)); }
      if (sp.get('category')) { where.push('p.category=?'); args.push(sp.get('category')); }
      if (sp.get('since')) { where.push('p.date>=?'); args.push(sp.get('since')); }
      if (sp.get('q')) { where.push('(p.title LIKE ? OR p.summary LIKE ?)'); args.push(`%${sp.get('q')}%`, `%${sp.get('q')}%`); }
      const rows = db.prepare(`SELECT p.*, (SELECT GROUP_CONCAT(s.name,'、') FROM policy_subjects ps JOIN subjects s ON s.id=ps.subject_id WHERE ps.policy_id=p.id) AS subject_names,
        (SELECT GROUP_CONCAT(t.name,'、') FROM policy_topics pt JOIN topics t ON t.id=pt.topic_id WHERE pt.policy_id=p.id) AS topic_names
        FROM policies p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.date DESC`).all(...args);
      return send(res, 200, rows);
    }
    if (p === '/policy-categories') return send(res, 200, db.prepare('SELECT category, COUNT(*) AS n FROM policies GROUP BY category ORDER BY n DESC').all());
    if (p === '/laws') return send(res, 200, db.prepare('SELECT l.*, (SELECT COUNT(*) FROM law_articles a WHERE a.law_id=l.id) AS article_count, (SELECT COUNT(*) FROM question_laws ql WHERE ql.law_id=l.id) AS question_count FROM laws l ORDER BY category, name').all());
    if ((r = m(/^\/laws\/(\d+)$/))) {
      const law = db.prepare('SELECT * FROM laws WHERE id=?').get(Number(r[1]));
      if (!law) return send(res, 404, { error: 'not found' });
      law.articles = db.prepare('SELECT * FROM law_articles WHERE law_id=? ORDER BY CAST(article_no AS INTEGER), article_no').all(law.id);
      law.questions = db.prepare('SELECT q.id, q.year, q.question_no, ql.article_no, substr(q.text,1,80) AS snippet, s.name AS subject_name FROM question_laws ql JOIN questions q ON q.id=ql.question_id JOIN subjects s ON s.id=q.subject_id WHERE ql.law_id=? ORDER BY q.year DESC').all(law.id);
      return send(res, 200, law);
    }
    if (p === '/resources') return send(res, 200, db.prepare('SELECT * FROM resources ORDER BY category, name').all());
    if (p === '/cram-schools') return send(res, 200, db.prepare('SELECT * FROM cram_schools ORDER BY name').all().map((c) => ({ ...c, courses: parseJSON(c.courses, []), methods: parseJSON(c.methods, []), materials: parseJSON(c.materials, []) })));
    if (p === '/study-plans') return send(res, 200, db.prepare('SELECT * FROM study_plans').all().map((x) => ({ ...x, plan: parseJSON(x.plan, []) })));
    if (p === '/progress') return send(res, 200, progress());
    if (p === '/search') return send(res, 200, sp.get('q') ? search(sp.get('q')) : {});
    if (p === '/stats') return send(res, 200, db.prepare('SELECT * FROM exam_stats ORDER BY year').all());
    return send(res, 404, { error: 'unknown endpoint' });
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (p === '/attempts') {
      if (!body.question_id) return send(res, 400, { error: 'question_id required' });
      db.prepare('INSERT INTO attempts (question_id,mode,duration_sec,self_score,rubric,answer_text,notes) VALUES (?,?,?,?,?,?,?)')
        .run(body.question_id, body.mode || 'practice', num(body.duration_sec), num(body.self_score), body.rubric ? JSON.stringify(body.rubric) : null, body.answer_text || null, body.notes || null);
      return send(res, 201, { ok: true, id: db.prepare('SELECT last_insert_rowid() AS id').get().id });
    }
    if (p === '/bookmarks') {
      const exists = db.prepare('SELECT 1 FROM bookmarks WHERE question_id=?').get(body.question_id);
      if (exists) db.prepare('DELETE FROM bookmarks WHERE question_id=?').run(body.question_id);
      else db.prepare('INSERT INTO bookmarks (question_id,note) VALUES (?,?)').run(body.question_id, body.note || null);
      return send(res, 200, { bookmarked: !exists });
    }
    if (p === '/notes') {
      db.prepare('INSERT INTO user_notes (ref_type,ref_id,content) VALUES (?,?,?)').run(body.ref_type || 'question', body.ref_id, body.content);
      return send(res, 201, { ok: true });
    }
    if (p === '/answers') { // 使用者自撰答案 / 補習班答案補登
      db.prepare('INSERT INTO answers (question_id,source_name,source_url,author,answer_type,content,license_note) VALUES (?,?,?,?,?,?,?)')
        .run(body.question_id, body.source_name || '自撰', body.source_url || null, body.author || null, body.answer_type || 'outline', body.content, body.license_note || null);
      return send(res, 201, { ok: true });
    }
    if (p === '/question-topics') { // 手動標註考點
      if (body.remove) db.prepare('DELETE FROM question_topics WHERE question_id=? AND topic_id=?').run(body.question_id, body.topic_id);
      else db.prepare('INSERT OR IGNORE INTO question_topics (question_id,topic_id) VALUES (?,?)').run(body.question_id, body.topic_id);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'unknown endpoint' });
  }
  if (req.method === 'DELETE') {
    if ((r = m(/^\/attempts\/(\d+)$/))) { db.prepare('DELETE FROM attempts WHERE id=?').run(Number(r[1])); return send(res, 200, { ok: true }); }
    if ((r = m(/^\/notes\/(\d+)$/))) { db.prepare('DELETE FROM user_notes WHERE id=?').run(Number(r[1])); return send(res, 200, { ok: true }); }
    if ((r = m(/^\/answers\/(\d+)$/))) { db.prepare('DELETE FROM answers WHERE id=?').run(Number(r[1])); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'unknown endpoint' });
  }
  return send(res, 405, { error: 'method not allowed' });
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => console.log(`估價師考試學習平台：http://localhost:${PORT}`));

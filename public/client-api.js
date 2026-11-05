/* 純靜態資料層：題庫等資料來自 data/db.json，個人學習紀錄存在瀏覽器 localStorage。
   介面與 server.js 的 /api 相同，app.js 不需要知道差別。 */
(() => {
  const USER_KEY = 'exam-user-v1';
  let bundle = null; let articlesCache = null;
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const idx = {};

  async function load() {
    if (bundle) return bundle;
    const r = await fetch('data/db.json');
    if (!r.ok) throw new Error('載入資料失敗，請確認 data/db.json 存在（npm run build）');
    bundle = await r.json();
    idx.subjects = byId(bundle.subjects); idx.topics = byId(bundle.topics); idx.questions = byId(bundle.questions); idx.laws = byId(bundle.laws);
    return bundle;
  }
  async function loadArticles() { if (!articlesCache) articlesCache = await (await fetch('data/articles.json')).json(); return articlesCache; }

  // ---------- 使用者資料（localStorage） ----------
  const emptyUser = () => ({ attempts: [], bookmarks: {}, notes: [], answers: [], topic_add: {}, topic_remove: {}, seq: 1 });
  function user() { try { return { ...emptyUser(), ...(JSON.parse(localStorage.getItem(USER_KEY)) || {}) }; } catch { return emptyUser(); } }
  function saveUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
  const nextId = (u) => u.seq++;
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  // ---------- 查詢輔助 ----------
  const subjectOf = (ref) => bundle.subjects.find((s) => s.code === ref || String(s.id) === String(ref));
  function topicIdsOf(q) {
    const u = user();
    const base = new Set(q.topic_ids);
    (u.topic_add[q.id] || []).forEach((t) => base.add(t));
    (u.topic_remove[q.id] || []).forEach((t) => base.delete(t));
    return [...base];
  }
  const topicNames = (ids) => ids.map((t) => idx.topics[t]?.name).filter(Boolean);
  const avgScore = (u, qid) => { const a = u.attempts.filter((x) => x.question_id === qid && x.self_score != null); return a.length ? a.reduce((s, x) => s + x.self_score, 0) / a.length : null; };
  const snippet = (s, n) => (s || '').slice(0, n);
  const qSubject = (q) => idx.subjects[q.subject_id];

  function listQuestions(sp) {
    const u = user();
    let rows = bundle.questions;
    if (sp.get('year')) rows = rows.filter((q) => q.year === Number(sp.get('year')));
    if (sp.get('subject')) { const s = subjectOf(sp.get('subject')); rows = s ? rows.filter((q) => q.subject_id === s.id) : []; }
    if (sp.get('type')) rows = rows.filter((q) => q.exam_type === sp.get('type'));
    if (sp.get('topic')) rows = rows.filter((q) => topicIdsOf(q).includes(Number(sp.get('topic'))));
    if (sp.get('q')) rows = rows.filter((q) => q.text.includes(sp.get('q')));
    if (sp.get('bookmarked') === '1') rows = rows.filter((q) => u.bookmarks[q.id]);
    if (sp.get('untagged') === '1') rows = rows.filter((q) => !topicIdsOf(q).length);
    if (sp.get('weak') === '1') rows = rows.filter((q) => { const a = avgScore(u, q.id); return a != null && a < 60; });
    rows = [...rows].sort((a, b) => b.year - a.year || qSubject(a).sort_order - qSubject(b).sort_order || a.exam_type.localeCompare(b.exam_type) || a.question_no - b.question_no);
    const page = Math.max(1, Number(sp.get('page') || 1)); const size = Math.min(100, Math.max(1, Number(sp.get('size') || 20)));
    const items = rows.slice((page - 1) * size, page * size).map((q) => ({
      id: q.id, year: q.year, exam_type: q.exam_type, question_no: q.question_no, score: q.score, text: q.text, verified: q.verified,
      subject_name: qSubject(q).name, subject_code: qSubject(q).code,
      answer_count: q.answers.length + u.answers.filter((a) => a.question_id === q.id).length,
      topic_names: topicNames(topicIdsOf(q)).join('、'), bookmarked: !!u.bookmarks[q.id], avg_score: avgScore(u, q.id),
    }));
    return { total: rows.length, page, size, items };
  }

  function questionDetail(id) {
    const q = idx.questions[id]; if (!q) return null;
    const u = user(); const s = qSubject(q);
    const tids = topicIdsOf(q);
    const related = bundle.policies.filter((p) => p.topic_ids.some((t) => tids.includes(t))).slice(0, 8).map((p) => ({ id: p.id, date: p.date, title: p.title, exam_angle: p.exam_angle }));
    const similar = bundle.questions.filter((x) => x.id !== q.id && topicIdsOf(x).some((t) => tids.includes(t))).slice(0, 10)
      .map((x) => ({ id: x.id, year: x.year, question_no: x.question_no, snippet: snippet(x.text, 80), subject_name: qSubject(x).name }));
    return {
      ...q, subject_name: s.name, subject_code: s.code,
      topics: tids.map((t) => ({ id: t, name: idx.topics[t]?.name })).filter((t) => t.name).sort((a, b) => a.name.localeCompare(b.name)),
      answers: [...q.answers, ...u.answers.filter((a) => a.question_id === q.id)].sort((a, b) => ({ full: 0, outline: 1 }[a.answer_type] ?? 2) - ({ full: 0, outline: 1 }[b.answer_type] ?? 2)),
      laws: q.laws.map((l) => ({ ...idx.laws[l.law_id], article_no: l.article_no })).filter((l) => l.name),
      related_policies: related, similar, bookmarked: !!u.bookmarks[q.id],
      attempts: u.attempts.filter((a) => a.question_id === q.id).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10),
      notes: u.notes.filter((n) => n.ref_type === 'question' && n.ref_id === q.id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }

  function heatmap(code) {
    const s = subjectOf(code); if (!s) return null;
    const qs = bundle.questions.filter((q) => q.subject_id === s.id);
    const years = [...new Set(qs.map((q) => q.year))].sort();
    const cellMap = {}; let untagged = 0;
    for (const q of qs) { const t = topicIdsOf(q); if (!t.length) untagged++; for (const tid of t) { const k = `${tid}-${q.year}`; cellMap[k] = cellMap[k] || { topic_id: tid, year: q.year, n: 0, score: 0 }; cellMap[k].n++; cellMap[k].score += q.score || 0; } }
    const cells = Object.values(cellMap);
    const topics = bundle.topics.filter((t) => t.subject_id === s.id).map((t) => ({ id: t.id, name: t.name, parent_id: t.parent_id, total: cells.filter((c) => c.topic_id === t.id).reduce((a, c) => a + c.n, 0) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { subject: { id: s.id, name: s.name }, years, topics, cells, untagged };
  }

  function predictions(code, targetYear) {
    const s = subjectOf(code); if (!s) return null;
    const qs = bundle.questions.filter((q) => q.subject_id === s.id);
    const latest = Math.max(114, ...qs.map((q) => q.year));
    const target = targetYear || latest + 1;
    const since = new Date(); since.setFullYear(since.getFullYear() - 2); const sinceStr = since.toISOString().slice(0, 7);
    const pols = bundle.policies.filter((p) => p.date >= sinceStr);
    const manual = bundle.predictions.filter((m) => m.subject_id === s.id);
    const items = bundle.topics.filter((t) => t.subject_id === s.id).map((t) => {
      const tq = qs.filter((q) => topicIdsOf(q).includes(t.id));
      const total = tq.length;
      const recent = tq.reduce((a, q) => a + Math.pow(0.8, Math.max(0, latest - q.year)), 0);
      const lastYear = tq.length ? Math.max(...tq.map((q) => q.year)) : null;
      const gap = lastYear ? target - lastYear : null;
      const tp = pols.filter((p) => p.topic_ids.includes(t.id));
      const man = manual.filter((m) => m.topic_id === t.id);
      const manualWeight = man.reduce((a, m) => a + (m.weight || 1), 0);
      const cycleBoost = total >= 3 && gap !== null && gap >= 2 && gap <= 4 ? 1.2 : 0;
      const policyBoost = Math.min(3, tp.length * 0.9);
      const score = recent + Math.min(3, total * 0.15) + cycleBoost + policyBoost + manualWeight;
      return { topic_id: t.id, topic: t.name, description: t.description, score: Math.round(score * 100) / 100, total, recent: Math.round(recent * 100) / 100, last_year: lastYear, gap, cycle_boost: cycleBoost, policy_boost: policyBoost,
        policies: tp.slice(0, 5).map((p) => ({ id: p.id, title: p.title, date: p.date })), manual: man };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    return { subject: s, latest_year: latest, target_year: target, items, unlinked_manual: manual.filter((m) => !m.topic_id) };
  }

  function mock(code, n) {
    const s = subjectOf(code); if (!s) return null;
    const pool = bundle.questions.filter((q) => q.subject_id === s.id && q.exam_type === '申論').sort(() => Math.random() - 0.5);
    const chosen = []; const used = new Set();
    for (const q of pool) { const ts = topicIdsOf(q); if (ts.length && ts.every((t) => used.has(t))) continue; chosen.push(q); ts.forEach((t) => used.add(t)); if (chosen.length >= n) break; }
    for (const q of pool) { if (chosen.length >= n) break; if (!chosen.includes(q)) chosen.push(q); }
    return { subject: s, duration_min: s.duration_min || 120, questions: chosen.map((q, i) => ({ id: q.id, year: q.year, question_no: q.question_no, text: q.text, order: i + 1, score: q.score || Math.round(100 / n) })) };
  }

  function overview() {
    const u = user();
    const years = [...new Set(bundle.questions.map((q) => q.year))].sort();
    const cov = {}; for (const q of bundle.questions) { const k = `${q.year}|${qSubject(q).code}`; cov[k] = (cov[k] || 0) + 1; }
    const scored = u.attempts.filter((a) => a.self_score != null);
    return {
      questions: bundle.questions.length, answers: bundle.questions.reduce((a, q) => a + q.answers.length, 0) + u.answers.length, policies: bundle.policies.length,
      laws: bundle.laws.length, articles: bundle.laws.reduce((a, l) => a + l.article_count, 0), topics: bundle.topics.length, resources: bundle.resources.length, schools: bundle.cram_schools.length,
      years, year_min: years[0] ?? null, year_max: years.at(-1) ?? null,
      by_subject: bundle.subjects.map((s) => { const qs = bundle.questions.filter((q) => q.subject_id === s.id); return { ...s, questions: qs.length, year_min: qs.length ? Math.min(...qs.map((q) => q.year)) : null, year_max: qs.length ? Math.max(...qs.map((q) => q.year)) : null, topics: bundle.topics.filter((t) => t.subject_id === s.id).length }; }),
      attempts: { n: u.attempts.length, avg: scored.length ? scored.reduce((a, x) => a + x.self_score, 0) / scored.length : null },
      bookmarks: Object.keys(u.bookmarks).length,
      recent_policies: bundle.policies.slice(0, 6).map((p) => ({ id: p.id, date: p.date, title: p.title, category: p.category })),
      stats: bundle.exam_stats,
      coverage: Object.entries(cov).map(([k, n]) => { const [year, code] = k.split('|'); return { year: Number(year), code, n }; }),
    };
  }

  function policies(sp) {
    let rows = bundle.policies;
    if (sp.get('subject')) { const s = subjectOf(sp.get('subject')); rows = s ? rows.filter((p) => p.subject_ids.includes(s.id)) : []; }
    if (sp.get('category')) rows = rows.filter((p) => p.category === sp.get('category'));
    if (sp.get('since')) rows = rows.filter((p) => p.date >= sp.get('since'));
    if (sp.get('q')) rows = rows.filter((p) => (p.title + (p.summary || '')).includes(sp.get('q')));
    return rows.map((p) => ({ ...p, subject_names: p.subject_ids.map((i) => idx.subjects[i]?.name).filter(Boolean).join('、'), topic_names: topicNames(p.topic_ids).join('、') }));
  }

  function progress() {
    const u = user();
    const bySubject = bundle.subjects.map((s) => {
      const qids = new Set(bundle.questions.filter((q) => q.subject_id === s.id).map((q) => q.id));
      const at = u.attempts.filter((a) => qids.has(a.question_id)); const scored = at.filter((a) => a.self_score != null);
      return { code: s.code, name: s.name, practiced: new Set(at.map((a) => a.question_id)).size, attempts: at.length, avg_score: scored.length ? Math.round(scored.reduce((x, a) => x + a.self_score, 0) / scored.length * 10) / 10 : null, total: [...qids].filter((id) => idx.questions[id].exam_type === '申論').length };
    });
    const topicAgg = {};
    for (const a of u.attempts) { if (a.self_score == null) continue; const q = idx.questions[a.question_id]; if (!q) continue; for (const t of topicIdsOf(q)) { topicAgg[t] = topicAgg[t] || { sum: 0, n: 0 }; topicAgg[t].sum += a.self_score; topicAgg[t].n++; } }
    const weak = Object.entries(topicAgg).map(([t, v]) => ({ id: Number(t), name: idx.topics[t]?.name, subject_name: idx.subjects[idx.topics[t]?.subject_id]?.name, avg_score: Math.round(v.sum / v.n * 10) / 10, attempts: v.n })).sort((a, b) => a.avg_score - b.avg_score).slice(0, 15);
    const recent = [...u.attempts].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 30).map((a) => { const q = idx.questions[a.question_id]; return { ...a, year: q?.year, question_no: q?.question_no, snippet: snippet(q?.text, 80), subject_name: q ? qSubject(q).name : '' }; });
    const dailyMap = {}; for (const a of u.attempts) { const d = a.started_at.slice(0, 10); dailyMap[d] = dailyMap[d] || { day: d, n: 0, seconds: 0 }; dailyMap[d].n++; dailyMap[d].seconds += a.duration_sec || 0; }
    const daily = Object.values(dailyMap).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 60);
    const bookmarks = Object.entries(u.bookmarks).map(([qid, b]) => { const q = idx.questions[qid]; return q ? { question_id: q.id, ...b, year: q.year, question_no: q.question_no, snippet: snippet(q.text, 80), subject_name: qSubject(q).name, id: q.id } : null; }).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { by_subject: bySubject, by_topic_weak: weak, recent, daily, bookmarks };
  }

  async function search(qstr) {
    const articles = await loadArticles();
    return {
      questions: bundle.questions.filter((q) => q.text.includes(qstr)).slice(0, 20).map((q) => ({ id: q.id, year: q.year, question_no: q.question_no, snippet: snippet(q.text, 120), subject_name: qSubject(q).name })),
      policies: bundle.policies.filter((p) => (p.title + (p.summary || '') + (p.exam_angle || '')).includes(qstr)).slice(0, 20).map((p) => ({ id: p.id, date: p.date, title: p.title, snippet: snippet(p.summary, 120) })),
      articles: articles.filter((a) => a.text.includes(qstr) || (a.title || '').includes(qstr)).slice(0, 20).map((a) => ({ ...a, snippet: snippet(a.text, 120) })),
      topics: bundle.topics.filter((t) => t.name.includes(qstr) || (t.keywords || '').includes(qstr)).slice(0, 20).map((t) => ({ id: t.id, name: t.name, subject_name: idx.subjects[t.subject_id]?.name, subject_code: idx.subjects[t.subject_id]?.code })),
    };
  }

  // ---------- 路由 ----------
  async function get(pathStr) {
    await load();
    const url = new URL(pathStr, 'http://x/'); const p = url.pathname; const sp = url.searchParams; let m;
    if (p === '/overview') return overview();
    if (p === '/subjects') return bundle.subjects;
    if (p === '/topics') {
      const s = sp.get('subject') ? subjectOf(sp.get('subject')) : null;
      const rows = bundle.topics.filter((t) => !s || t.subject_id === s.id).map((t) => ({ ...t, subject_code: idx.subjects[t.subject_id]?.code, question_count: bundle.questions.filter((q) => topicIdsOf(q).includes(t.id)).length }));
      return rows.sort((a, b) => (s ? 0 : idx.subjects[a.subject_id].sort_order - idx.subjects[b.subject_id].sort_order) || b.question_count - a.question_count || a.name.localeCompare(b.name));
    }
    if (p === '/questions') return listQuestions(sp);
    if ((m = p.match(/^\/questions\/(\d+)$/))) { const q = questionDetail(Number(m[1])); if (!q) throw new Error('not found'); return q; }
    if (p === '/years') { const c = {}; bundle.questions.forEach((q) => { c[q.year] = (c[q.year] || 0) + 1; }); return Object.entries(c).map(([year, n]) => ({ year: Number(year), n })).sort((a, b) => b.year - a.year); }
    if (p === '/heatmap') return heatmap(sp.get('subject')) || Promise.reject(new Error('subject not found'));
    if (p === '/predictions') return predictions(sp.get('subject'), Number(sp.get('year')) || null) || Promise.reject(new Error('subject not found'));
    if (p === '/mock') return mock(sp.get('subject'), Math.min(10, Math.max(1, Number(sp.get('n') || 4)))) || Promise.reject(new Error('subject not found'));
    if (p === '/policies') return policies(sp);
    if (p === '/policy-categories') { const c = {}; bundle.policies.forEach((x) => { c[x.category] = (c[x.category] || 0) + 1; }); return Object.entries(c).map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n); }
    if (p === '/laws') return bundle.laws;
    if ((m = p.match(/^\/laws\/(\d+)$/))) {
      const law = await (await fetch(`data/laws/${m[1]}.json`)).json();
      law.questions = bundle.questions.filter((q) => q.laws.some((l) => l.law_id === law.id)).map((q) => ({ id: q.id, year: q.year, question_no: q.question_no, article_no: q.laws.find((l) => l.law_id === law.id)?.article_no, snippet: snippet(q.text, 80), subject_name: qSubject(q).name }));
      return law;
    }
    if (p === '/resources') return bundle.resources;
    if (p === '/cram-schools') return bundle.cram_schools;
    if (p === '/study-plans') return bundle.study_plans;
    if (p === '/progress') return progress();
    if (p === '/search') return sp.get('q') ? search(sp.get('q')) : {};
    if (p === '/stats') return bundle.exam_stats;
    if (p === '/user-export') return user();
    throw new Error('unknown endpoint ' + p);
  }

  async function post(pathStr, body) {
    await load();
    const u = user();
    if (pathStr === '/attempts') { u.attempts.push({ id: nextId(u), question_id: body.question_id, mode: body.mode || 'practice', started_at: now(), duration_sec: body.duration_sec ?? null, self_score: body.self_score ?? null, rubric: body.rubric || null, answer_text: body.answer_text || null, notes: body.notes || null }); saveUser(u); return { ok: true }; }
    if (pathStr === '/bookmarks') { const on = !u.bookmarks[body.question_id]; if (on) u.bookmarks[body.question_id] = { created_at: now(), note: body.note || null }; else delete u.bookmarks[body.question_id]; saveUser(u); return { bookmarked: on }; }
    if (pathStr === '/notes') { u.notes.push({ id: nextId(u), ref_type: body.ref_type || 'question', ref_id: body.ref_id, content: body.content, created_at: now() }); saveUser(u); return { ok: true }; }
    if (pathStr === '/answers') { u.answers.push({ id: 'u' + nextId(u), question_id: body.question_id, source_name: body.source_name || '自撰', source_url: body.source_url || null, author: body.author || null, answer_type: body.answer_type || 'outline', content: body.content, license_note: body.license_note || null, created_at: now() }); saveUser(u); return { ok: true }; }
    if (pathStr === '/question-topics') {
      const add = u.topic_add[body.question_id] || []; const rem = u.topic_remove[body.question_id] || [];
      if (body.remove) { u.topic_add[body.question_id] = add.filter((t) => t !== body.topic_id); if (!rem.includes(body.topic_id)) rem.push(body.topic_id); u.topic_remove[body.question_id] = rem; }
      else { u.topic_remove[body.question_id] = rem.filter((t) => t !== body.topic_id); if (!add.includes(body.topic_id)) add.push(body.topic_id); u.topic_add[body.question_id] = add; }
      saveUser(u); return { ok: true };
    }
    if (pathStr === '/user-import') { const data = body && typeof body === 'object' ? body : {}; saveUser({ ...emptyUser(), ...data }); return { ok: true }; }
    if (pathStr === '/user-reset') { localStorage.removeItem(USER_KEY); return { ok: true }; }
    throw new Error('unknown endpoint ' + pathStr);
  }

  async function del(pathStr) {
    const u = user(); let m;
    if ((m = pathStr.match(/^\/attempts\/(\d+)$/))) u.attempts = u.attempts.filter((a) => a.id !== Number(m[1]));
    else if ((m = pathStr.match(/^\/notes\/(\d+)$/))) u.notes = u.notes.filter((a) => a.id !== Number(m[1]));
    else if ((m = pathStr.match(/^\/answers\/(u\d+)$/))) u.answers = u.answers.filter((a) => a.id !== m[1]);
    else throw new Error('unknown endpoint ' + pathStr);
    saveUser(u); return { ok: true };
  }

  window.ClientAPI = { get, post, del, load };
})();

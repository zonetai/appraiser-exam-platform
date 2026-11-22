/* 估價師考試學習平台 前端（原生 JS，無框架） */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app');
  const state = { subjects: [], topicsBySubject: {} };

  // ---------- 工具 ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); };
  // 資料層：純靜態（data/db.json ＋ localStorage），見 client-api.js
  const api = (path) => window.ClientAPI.get(path);
  const post = (path, body) => window.ClientAPI.post(path, body);
  const del = (path) => window.ClientAPI.del(path);
  const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const roc = (y) => `${y}年`;
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

  // 極簡 Markdown
  function md(src) {
    if (!src) return '';
    const lines = esc(src).replace(/\r/g, '').split('\n');
    let html = ''; let list = null; let para = [];
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const flushP = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); html += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; continue; }
      if ((m = line.match(/^>\s?(.*)/))) { flushP(); flushL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); list = 'ul'; html += '<ul>'; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = line.match(/^\s*(\d+)[.)、]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); list = 'ol'; html += '<ol>'; } html += `<li>${inline(m[2])}</li>`; continue; }
      if (line.startsWith('|')) { flushP(); flushL(); const cells = line.split('|').slice(1, -1); if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue; html += `<table><tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr></table>`; continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return `<div class="md">${html.replace(/<\/table><table>/g, '')}</div>`;
  }

  const subjectName = (code) => state.subjects.find((s) => s.code === code)?.name || code;
  const subjectOptions = (sel, allLabel = '全部科目') => `<option value="">${allLabel}</option>` + state.subjects.map((s) => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  // 專業科目（不含國文）供模擬考／考點分析／猜題使用
  const proSubjects = () => state.subjects.filter((s) => s.code !== 'chinese');
  const proOptions = (sel) => proSubjects().map((s) => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const defaultPro = () => proSubjects()[0]?.code;
  const qLink = (q, label) => `<a href="#/question/${q.id}">${label ?? `${roc(q.year)} ${esc(q.subject_name || '')} 第${q.question_no}題`}</a>`;

  // ---------- 路由 ----------
  const routes = {
    '': home, questions, question, mock, plan, guide, analysis, predict, me, laws, law, policies, resources, schools, about, search,
  };
  async function router() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = hash.split('/');
    const [base, query] = name.split('?');
    const params = new URLSearchParams(query || (rest.join('/').includes('?') ? rest.join('/').split('?')[1] : ''));
    document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === base));
    $('#sidebar').classList.remove('open');
    const fn = routes[base] || notFound;
    app.innerHTML = '<div class="loading">載入中…</div>';
    try { await fn(rest.map((x) => x.split('?')[0]), params); } catch (e) { app.innerHTML = `<div class="card"><h1>發生錯誤</h1><p class="muted">${esc(e.message)}</p></div>`; }
    window.scrollTo(0, 0);
  }
  function notFound() { app.innerHTML = '<div class="card"><h1>找不到頁面</h1><p><a href="#/">回總覽</a></p></div>'; }

  // ---------- 總覽 ----------
  async function home() {
    const o = await api('/overview');
    const years = o.years;
    const covMap = {}; o.coverage.forEach((c) => { covMap[`${c.year}-${c.code}`] = c.n; });
    const covTable = years.length ? `<div class="coverage" style="overflow-x:auto"><table><tr><th>年度</th>${o.by_subject.map((s) => `<th>${esc(s.name.replace(/不動產/g, ''))}</th>`).join('')}</tr>
      ${[...years].reverse().map((y) => `<tr><td>${roc(y)}</td>${o.by_subject.map((s) => { const n = covMap[`${y}-${s.code}`]; return n ? `<td class="ok"><a href="#/questions?year=${y}&subject=${s.code}">${n}</a></td>` : '<td class="none">—</td>'; }).join('')}</tr>`).join('')}</table></div>` : '<p class="empty">尚無試題資料，請執行匯入腳本。</p>';
    const stats = o.stats || [];
    const maxRate = Math.max(1, ...stats.map((s) => s.pass_rate || 0));
    const statChart = stats.length ? `<div class="chart-bars">${stats.map((s) => `<div class="b" style="height:${Math.max(4, (s.pass_rate || 0) / maxRate * 100)}%" title="${roc(s.year)} 到考 ${s.attendees ?? '?'} 人，及格 ${s.passed ?? '?'} 人"><span>${s.pass_rate != null ? s.pass_rate.toFixed(1) + '%' : ''}</span></div>`).join('')}</div><div class="chart-labels">${stats.map((s) => `<div>${s.year}</div>`).join('')}</div>` : '<p class="muted small">尚無統計資料</p>';
    const examDate = store.get('examDate', DEFAULT_EXAM_DATE);
    app.innerHTML = `
      <h1>總覽</h1>
      <div class="grid grid-4">
        <div class="card stat"><div class="num">${o.questions}</div><div class="label">歷年試題（${o.year_min ? roc(o.year_min) + '–' + roc(o.year_max) : '—'}）</div></div>
        <div class="card stat"><div class="num">${o.rubrics}</div><div class="label">題有得分要點・可自動批改（另有 ${o.links} 個補習班解答連結）</div></div>
        <div class="card stat"><div class="num">${o.policies}</div><div class="label">政策與修法動態</div></div>
        <div class="card stat"><div class="num">${o.laws}<span class="muted" style="font-size:1rem">／${o.articles}條</span></div><div class="label">法規與重點條文</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="flex between"><h2 style="margin-top:0">快速開始</h2>${examDate ? `<span class="tag amber">距考試 ${daysTo(examDate)} 天</span>` : '<a class="small" href="#/about">設定考試日期</a>'}</div>
          <div class="flex">
            <a class="btn btn-primary" href="#/mock">⏱ 來一場模擬考</a>
            <a class="btn" href="#/questions?weak=1">🔁 複習弱點題</a>
            <a class="btn" href="#/predict">🎯 看本年猜題</a>
            <a class="btn" href="#/plan">📅 今天的讀書任務</a>
          </div>
          <h3>學習紀錄</h3>
          <p class="small muted">累計練習 ${o.attempts.n} 次，平均自評 ${o.attempts.avg ? o.attempts.avg.toFixed(1) : '—'} 分；收藏 ${o.bookmarks} 題。<a href="#/me">查看詳細</a></p>
          <h3>各科題庫</h3>
          <table>${o.by_subject.map((s) => `<tr><td><a href="#/questions?subject=${s.code}">${esc(s.name)}</a><div class="small muted">${esc(s.exam_type)}${s.duration_min ? '・' + s.duration_min + ' 分' : ''}</div></td><td class="right">${s.questions} 題<div class="small muted">${s.topics} 個考點</div></td></tr>`).join('')}</table>
        </div>
        <div class="card">
          <h2 style="margin-top:0">最新政策動態</h2>
          ${o.recent_policies.map((p) => `<div class="q-item"><div class="meta">${esc(p.date)} ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}</div><a href="#/policies?focus=${p.id}">${esc(p.title)}</a></div>`).join('') || '<p class="empty">尚無資料</p>'}
          <p class="right small"><a href="#/policies">全部政策動態 →</a></p>
          <h2>歷年及格率</h2>${statChart}
        </div>
      </div>
      <div class="card"><h2 style="margin-top:0">題庫覆蓋年度 × 科目</h2><p class="small muted">數字為已收錄題數，點擊可直接篩選。缺的格子代表尚未匯入，可用 <code>npm run fetch:moex</code> 補抓考選部試題。</p>${covTable}</div>`;
  }
  const daysTo = (d) => Math.ceil((new Date(d) - new Date()) / 86400000);
  const DEFAULT_EXAM_DATE = '2027-08-21'; // 116 年預定考試日（三民／公職王整理，以考選部公告為準）

  // ---------- 題庫 ----------
  async function questions(_, params) {
    const subject = params.get('subject') || '';
    const topics = subject ? await api(`/topics?subject=${subject}`) : [];
    const years = await api('/years');
    const data = await api(`/questions?${params.toString()}`);
    const qs = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== 'page') p.delete('page'); return `#/questions?${p}`; };
    app.innerHTML = `
      <h1>歷年題庫 <span class="muted small">共 ${data.total} 題</span></h1>
      <div class="card">
        <div class="row">
          <label>科目<br><select id="fSubject">${subjectOptions(subject)}</select></label>
          <label>年度<br><select id="fYear"><option value="">全部年度</option>${years.map((y) => `<option value="${y.year}" ${String(y.year) === params.get('year') ? 'selected' : ''}>${roc(y.year)}（${y.n}）</option>`).join('')}</select></label>
          ${subject ? `<label>考點<br><select id="fTopic"><option value="">全部考點</option>${topics.map((t) => `<option value="${t.id}" ${String(t.id) === params.get('topic') ? 'selected' : ''}>${esc(t.name)}（${t.question_count}）</option>`).join('')}</select></label>` : ''}
          <label>題型<br><select id="fType"><option value="">全部</option><option value="申論" ${params.get('type') === '申論' ? 'selected' : ''}>申論</option><option value="測驗" ${params.get('type') === '測驗' ? 'selected' : ''}>測驗</option></select></label>
          <label>關鍵字<br><input id="fQ" value="${esc(params.get('q') || '')}" placeholder="例：收益法、權利變換"></label>
          <label class="small"><input type="checkbox" id="fBook" ${params.get('bookmarked') === '1' ? 'checked' : ''}> 只看收藏</label>
          <label class="small"><input type="checkbox" id="fWeak" ${params.get('weak') === '1' ? 'checked' : ''}> 只看弱點（自評&lt;60）</label>
          <button class="btn btn-primary" id="fGo">篩選</button>
          <a class="btn" href="#/questions">清除</a>
        </div>
      </div>
      <div class="card" id="qList">
        ${data.items.map(qItem).join('') || '<p class="empty">沒有符合條件的題目</p>'}
        ${pager(data, (p) => qs('page', p))}
      </div>`;
    $('#fGo').onclick = () => {
      const p = new URLSearchParams();
      const set = (k, v) => v && p.set(k, v);
      set('subject', $('#fSubject').value); set('year', $('#fYear').value); set('type', $('#fType').value); set('q', $('#fQ').value.trim());
      if ($('#fTopic')) set('topic', $('#fTopic').value);
      if ($('#fBook').checked) p.set('bookmarked', '1'); if ($('#fWeak').checked) p.set('weak', '1');
      location.hash = `#/questions?${p}`;
    };
    $('#fSubject').onchange = () => { location.hash = qs('subject', $('#fSubject').value).replace(/&topic=\d+/, ''); };
    $('#fQ').onkeydown = (e) => { if (e.key === 'Enter') $('#fGo').click(); };
  }
  function qItem(q) {
    const topics = (q.topic_names || '').split('、').filter(Boolean);
    return `<div class="q-item">
      <div class="meta"><b>${roc(q.year)}</b> ${esc(q.subject_name)} 第 ${q.question_no} 題 ${q.score ? `（${q.score} 分）` : ''} <span class="tag ${q.exam_type === '測驗' ? 'purple' : ''}">${esc(q.exam_type)}</span>
        ${q.answer_count ? `<span class="tag green">${q.answer_count} 份解答</span>` : ''} ${q.bookmarked ? '<span class="tag amber">★ 收藏</span>' : ''}
        ${q.avg_score != null ? `<span class="tag ${q.avg_score < 60 ? 'red' : 'green'}">自評 ${Math.round(q.avg_score)}</span>` : ''} ${q.verified ? '' : '<span class="tag red">待核對</span>'}</div>
      <div class="text"><a href="#/question/${q.id}">${esc(q.text.length > 260 ? q.text.slice(0, 260) + '…' : q.text)}</a></div>
      <div>${topics.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
  }
  function pager(data, hrefFor) {
    const pages = Math.ceil(data.total / data.size);
    if (pages <= 1) return '';
    const btn = (p, label) => p >= 1 && p <= pages ? `<a class="btn btn-sm" href="${hrefFor(p)}">${label}</a>` : `<span class="btn btn-sm muted">${label}</span>`;
    return `<div class="pager">${btn(data.page - 1, '上一頁')}<span class="small">第 ${data.page} / ${pages} 頁</span>${btn(data.page + 1, '下一頁')}</div>`;
  }

  // ---------- 題目詳情 + 練習 ----------
  const RUBRIC = [
    ['題意掌握：是否正確判讀題目問什麼、拆成幾個子題', 20],
    ['法條／定義引用：條號正確、定義完整、用語精準', 25],
    ['論述架構：標題化、層次分明、先總後分、有學說與實務', 25],
    ['計算與應用：公式、步驟、單位、結果合理（無計算則看案例應用）', 20],
    ['結論與時間：有明確結論、篇幅與時間控制得當', 10],
  ];
  // 得分要點（本站原創）
  function renderRubric(r) {
    if (!r) return '';
    const lawsTxt = (r.laws || []).map((l) => `${esc(l.law)}${(l.articles || []).length ? ' 第 ' + l.articles.map(esc).join('、') + ' 條' : ''}`).join('；');
    return `<div class="rubric-box"><h3 style="margin-top:0">本站得分要點 <span class="tag green">自動批改依據</span></h3>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
      ${(r.outline || []).length ? `<b class="small">建議大綱</b><ul class="small">${r.outline.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      <table><tr><th>得分點</th><th style="width:52px">配重</th><th>關鍵詞</th></tr>${r.points.map((p) => `<tr><td><b>${esc(p.title)}</b>${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}</td><td>${p.weight}%</td><td class="small">${(p.keywords || []).map((k) => `<span class="tag">${esc(String(k).split('|')[0])}</span>`).join('')}</td></tr>`).join('')}</table>
      ${lawsTxt ? `<p class="small"><b>應引用法條：</b>${lawsTxt}</p>` : ''}
      ${(r.answers || []).length ? `<p class="small"><b>計算參考值：</b>${r.answers.map((a) => `${esc(a.label)} ≈ ${Number(a.value).toLocaleString('zh-TW', { maximumFractionDigits: 4 })}${esc(a.unit || '')}`).join('；')}</p>` : ''}
      ${r.figure ? `<p class="small"><b>應畫圖：</b>${esc(r.figure)}</p>` : ''}
      ${r.note ? `<p class="small muted">※ ${esc(r.note)}</p>` : ''}
      <p class="small muted">得分要點為本站依現行法規與通說整理，非考選部或補習班公布之標準答案。</p></div><hr>`;
  }
  // 自動批改結果
  function renderGrade(res) {
    const cls = res.pct >= 80 ? 'green' : res.pct >= 60 ? 'amber' : 'red';
    const icon = { full: '✅', partial: '🟡', miss: '❌' };
    return `<div class="grade-box">
      <div class="flex between"><div><span class="score-big">${res.score}</span> <span class="muted">／ ${res.max} 分</span> <span class="tag ${cls}">${res.pct}%・${res.band}</span></div><span class="small muted">自動批改（關鍵詞比對）</span></div>
      ${res.parts.map((p) => `<div class="flex small" style="margin:.2rem 0"><span style="width:170px">${esc(p.label)}（${Math.round(p.weight * 100)}%）</span><div class="bar ${p.score >= 0.8 ? 'green' : p.score >= 0.5 ? 'amber' : 'red'}" style="flex:1"><span style="width:${Math.round(p.score * 100)}%"></span></div><b style="width:44px;text-align:right">${Math.round(p.score * 100)}%</b></div>`).join('')}
      <table style="margin-top:.5rem"><tr><th></th><th>得分點</th><th>配重</th><th>命中／可補充</th></tr>${res.points.map((p) => `<tr><td>${icon[p.status]}</td><td>${esc(p.title)}</td><td>${Math.round(p.weight)}%</td><td class="small">${p.hits.length ? `<span class="muted">命中：</span>${p.hits.map(esc).join('、')}` : ''}${p.status !== 'full' && p.misses.length ? `${p.hits.length ? '<br>' : ''}<span class="muted">可補：</span>${p.misses.slice(0, 5).map(esc).join('、')}` : ''}</td></tr>`).join('')}</table>
      ${res.calc ? `<p class="small"><b>計算結果：</b>${res.calc.items.map((x) => `${x.hit ? '✅' : '❌'} ${esc(x.label)}`).join('　')}</p>` : ''}
      ${res.law ? `<p class="small"><b>法條：</b>已引用 ${res.law.got.length}／${res.law.wanted.length} 條${res.law.cited.length ? `（你寫到的條號：${res.law.cited.slice(0, 12).map(esc).join('、')}）` : ''}</p>` : ''}
      ${res.tips.length ? `<b class="small">改進建議</b><ul class="small">${res.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="small">各項皆達標，請再對照參考答案檢查論述是否正確。</p>'}
      <p class="small muted">自動批改只檢查「有沒有寫到」，無法判斷論述對錯與邏輯；分數供自我檢核，不等於閱卷成績。</p></div>`;
  }
  // AI 批改（選用，需部署 Supabase Edge Function 並設定端點）
  function aiConfig() { const c = window.APP_CONFIG || {}; return { endpoint: store.get('aiEndpoint', '') || c.aiEndpoint || '', key: store.get('aiKey', '') || c.aiAnonKey || '' }; }
  async function aiGrade(q, answer) {
    const { endpoint, key } = aiConfig();
    const r = q.rubric || {};
    const body = { question: { year: q.year, subject: q.subject_name, no: q.question_no, score: q.score || 25, text: q.text },
      rubric: { summary: r.summary, points: (r.points || []).map((p) => ({ title: p.title, weight: p.weight, note: p.note })), laws: r.laws, outline: r.outline, answers: r.answers, figure: r.figure }, answer };
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}`, apikey: key } : {}) }, body: JSON.stringify(body) })
      .catch(() => { throw new Error('無法連線到 AI 批改服務，請檢查網路後再試'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  function renderAI(r, q) {
    const cls = r.pct >= 80 ? 'green' : r.pct >= 60 ? 'amber' : 'red';
    const li = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
    return `<div class="grade-box ai"><div class="flex between"><div><span class="score-big">${r.score}</span> <span class="muted">／ ${q.score || 25} 分</span> <span class="tag ${cls}">${r.pct}%</span></div><span class="small muted">AI 批改</span></div>
      ${r.overall ? `<p>${esc(r.overall)}</p>` : ''}
      ${(r.breakdown || []).length ? `<table><tr><th>得分點</th><th style="width:70px">得分</th><th>評語</th></tr>${r.breakdown.map((b) => `<tr><td>${esc(b.title)}</td><td>${b.got}／${b.max}</td><td class="small">${esc(b.comment || '')}</td></tr>`).join('')}</table>` : ''}
      ${(r.strengths || []).length ? `<b class="small">優點</b><ul class="small">${li(r.strengths)}</ul>` : ''}
      ${(r.weaknesses || []).length ? `<b class="small">缺失</b><ul class="small">${li(r.weaknesses)}</ul>` : ''}
      ${(r.suggestions || []).length ? `<b class="small">修改建議</b><ul class="small">${li(r.suggestions)}</ul>` : ''}
      <p class="small muted">AI 批改為模型依得分要點所作之評估，可能有誤，請對照法條與參考答案。</p></div>`;
  }

  async function question([id]) {
    const q = await api(`/questions/${id}`);
    const allTopics = state.topicsBySubject[q.subject_code] || (state.topicsBySubject[q.subject_code] = await api(`/topics?subject=${q.subject_code}`));
    const linkAnswers = q.answers.filter((a) => a.answer_type === 'link');
    const textAnswers = q.answers.filter((a) => a.answer_type !== 'link');
    const sources = [...new Set(textAnswers.map((a) => a.source_name))];
    const linksHtml = linkAnswers.length ? `<h3>補習班解答原始連結</h3><ul class="small">${linkAnswers.map((a) => `<li><a href="${esc(a.source_url)}" target="_blank" rel="noopener">${esc(a.source_name)} ↗</a>${a.license_note && /登入/.test(a.license_note) ? ' <span class="tag amber">需會員登入</span>' : ''}</li>`).join('')}</ul><p class="small muted">※ 補習班詳解為各機構著作，本站只提供連結，不轉載內容。</p>` : '';
    const answersHtml = textAnswers.length ? `
      <div class="tabs" id="ansTabs">${sources.map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-src="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      ${sources.map((s, i) => `<div class="ans-pane" data-src="${esc(s)}" style="${i ? 'display:none' : ''}">${textAnswers.filter((a) => a.source_name === s).map((a) => `
        <div class="small muted flex between"><span>${a.author ? '作者：' + esc(a.author) + '・' : ''}類型：${a.answer_type === 'full' ? '完整解答' : a.answer_type === 'outline' ? '解題要點' : '外部連結'}${a.source_url ? `・<a href="${esc(a.source_url)}" target="_blank" rel="noopener">原始來源</a>` : ''}</span>
          ${String(a.id).startsWith('u') ? `<button class="btn btn-sm btn-danger" data-del-ans="${a.id}">刪除</button>` : ''}</div>
        ${a.content ? md(a.content) : '<p class="muted">僅提供連結</p>'}
        ${a.license_note ? `<p class="small muted">※ ${esc(a.license_note)}</p>` : ''}`).join('<hr>')}</div>`).join('')}` : (q.rubric ? '' : '<p class="empty">此題尚無參考答案。可在下方「加入解答」補登補習班解題要點或自撰答案。</p>');
    const aiOn = !!aiConfig().endpoint;

    app.innerHTML = `
      <p class="small"><a href="#/questions?subject=${q.subject_code}&year=${q.year}">← ${roc(q.year)} ${esc(q.subject_name)}</a></p>
      <div class="flex between">
        <h1 style="margin:0">${roc(q.year)} ${esc(q.subject_name)} 第 ${q.question_no} 題 ${q.score ? `<span class="muted small">（${q.score} 分）</span>` : ''}</h1>
        <div class="flex">
          <button id="bmBtn" class="btn ${q.bookmarked ? 'btn-accent' : ''}">${q.bookmarked ? '★ 已收藏' : '☆ 收藏'}</button>
          ${q.source_url ? `<a class="btn" href="${esc(q.source_url)}" target="_blank" rel="noopener">考選部原卷</a>` : ''}
          <button class="btn" onclick="window.print()">列印</button>
        </div>
      </div>
      <div class="card">
        <div class="q-text">${esc(q.text)}</div>
        ${q.options ? `<ol type="A" style="margin-top:.6rem">${(Array.isArray(q.options) ? q.options : Object.values(q.options)).map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}
        ${q.official_answer ? `<p><span class="tag green">考選部公布答案：${esc(q.official_answer)}</span></p>` : ''}
        <div style="margin-top:.6rem">考點：${q.topics.map((t) => `<span class="tag clickable" data-topic="${t.id}" title="點擊移除標註">${esc(t.name)} ×</span>`).join('') || '<span class="muted small">尚未標註</span>'}
          <select id="addTopic" class="btn-sm"><option value="">＋ 加標考點</option>${allTopics.filter((t) => !q.topics.some((x) => x.id === t.id)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        ${q.laws.length ? `<div class="small" style="margin-top:.4rem">相關法條：${q.laws.map((l) => `<a href="#/law/${l.id}">${esc(l.short_name || l.name)}${l.article_no ? ' §' + esc(l.article_no) : ''}</a>`).join('、')}</div>` : ''}
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h2 style="margin-top:0">作答練習</h2>
          <div class="flex between"><span class="timer" id="timer">00:00</span><span class="small muted">建議每題 25–30 分鐘；申論一科 4 題 120 分鐘</span></div>
          <div class="flex" style="margin:.4rem 0"><button class="btn btn-sm" id="tStart">▶ 開始計時</button><button class="btn btn-sm" id="tPause">⏸ 暫停</button><button class="btn btn-sm" id="tReset">↺ 重設</button>
            <label class="small">倒數 <input id="tLimit" type="number" value="25" min="5" max="120" style="width:60px"> 分</label></div>
          <textarea id="answerText" placeholder="依「破題定義 → 法條依據 → 分析／學說 → 實務／計算 → 結論」架構作答。可直接在此打字，或在紙上作答後只填自評。">${esc(store.get(`draft-${q.id}`, ''))}</textarea>
          <div class="flex between"><div class="flex">
              <button class="btn btn-accent" id="autoGrade" ${q.rubric ? '' : 'disabled title="本題尚未建立得分要點"'}>🤖 自動批改</button>
              ${aiOn ? '<button class="btn" id="aiGrade">✨ AI 批改</button>' : ''}
            </div><span class="small muted" id="wordCount"></span></div>
          <div id="gradeResult"></div>
          <div id="aiResult"></div>
          <details style="margin-top:.6rem"><summary>手動自評量表（紙上作答或想自行評分時使用）</summary>
            <div class="rubric" style="margin-top:.5rem">${RUBRIC.map(([label, w], i) => `<div class="rubric-row"><span>${esc(label)}<span class="muted">（${w}）</span></span><input type="range" min="0" max="5" value="3" data-w="${w}" id="r${i}"><b id="rv${i}">${w * 0.6}</b></div>`).join('')}</div>
            <p>自評總分：<span class="score-big" id="rubricTotal">60</span></p></details>
          <div class="flex between" style="margin-top:.6rem"><span class="small" id="scoreSource">紀錄將採用：<b>手動自評</b></span>
            <div class="flex"><input id="attemptNote" placeholder="備註（錯在哪、下次要補什麼）" style="width:230px"><button class="btn btn-primary" id="saveAttempt">儲存練習紀錄</button></div></div>
          ${q.attempts.length ? `<h3>歷次練習</h3><table><tr><th>時間</th><th>模式</th><th>用時</th><th>分數</th><th>評分方式</th><th>備註</th><th></th></tr>${q.attempts.map((a) => `<tr><td>${esc(a.started_at)}</td><td>${esc(a.mode)}</td><td>${a.duration_sec != null ? fmtTime(a.duration_sec) : '—'}</td><td>${a.self_score ?? '—'}</td><td>${a.graded_by === 'ai' ? 'AI' : a.graded_by === 'auto' ? '自動' : '自評'}</td><td>${esc(a.notes || '')}</td><td><button class="btn btn-sm btn-danger" data-del-att="${a.id}">刪</button></td></tr>`).join('')}</table>` : ''}
        </div>
        <div class="card">
          <h2 style="margin-top:0">參考答案 <span class="muted small">${q.rubric ? '得分要點・' : ''}${textAnswers.length} 份解題要點・${linkAnswers.length} 個補習班連結</span></h2>
          <details ${q.rubric || q.answers.length ? '' : 'open'}><summary>先自己作答，再展開看解答與得分要點</summary><div style="margin-top:.6rem">${renderRubric(q.rubric)}${answersHtml}${linksHtml}</div></details>
          <details style="margin-top:.8rem"><summary>加入解答（補習班要點／自撰）</summary>
            <div style="margin-top:.5rem"><input id="ansSource" placeholder="來源，例：高點 113 考後解答 / 自撰" style="width:100%"><input id="ansUrl" placeholder="來源網址（選填）" style="width:100%;margin-top:.3rem">
            <textarea id="ansContent" placeholder="支援 Markdown。請以「解題要點」形式摘要補習班解答並附來源，避免整篇轉貼。"></textarea>
            <button class="btn btn-primary btn-sm" id="ansSave">儲存解答</button></div></details>
          <h3>我的筆記</h3>
          ${q.notes.map((n) => `<div class="note">${esc(n.content)} <button class="btn btn-sm btn-danger" data-del-note="${n.id}" style="float:right">刪</button></div>`).join('')}
          <div class="flex"><input id="noteInput" placeholder="記下關鍵法條、口訣、易錯點…" style="flex:1"><button class="btn btn-sm" id="noteSave">新增</button></div>
          ${q.related_policies.length ? `<h3>相關政策／修法（可能的新考點）</h3>${q.related_policies.map((p) => `<div class="small"><span class="muted">${esc(p.date)}</span> <a href="#/policies?focus=${p.id}">${esc(p.title)}</a></div>`).join('')}` : ''}
          ${q.similar.length ? `<h3>同考點歷年題</h3>${q.similar.map((s) => `<div class="small">${qLink(s, `${roc(s.year)} 第${s.question_no}題`)}：<span class="muted">${esc(s.snippet)}…</span></div>`).join('')}` : ''}
        </div>
      </div>`;

    // 計時器
    let sec = 0, running = false, h = null;
    const tEl = $('#timer');
    const tick = () => { sec++; tEl.textContent = fmtTime(sec); const lim = Number($('#tLimit').value) * 60; tEl.classList.toggle('warn', sec >= lim); if (sec === lim) toast('時間到！建議收尾寫結論'); };
    $('#tStart').onclick = () => { if (!running) { running = true; h = setInterval(tick, 1000); } };
    $('#tPause').onclick = () => { running = false; clearInterval(h); };
    $('#tReset').onclick = () => { running = false; clearInterval(h); sec = 0; tEl.textContent = '00:00'; tEl.classList.remove('warn'); };
    const ta = $('#answerText');
    const wc = () => { $('#wordCount').textContent = `${ta.value.replace(/\s/g, '').length} 字`; store.set(`draft-${q.id}`, ta.value); };
    ta.oninput = wc; wc();
    const calc = () => { let total = 0; RUBRIC.forEach(([, w], i) => { const v = Number($(`#r${i}`).value) / 5 * w; $(`#rv${i}`).textContent = Math.round(v); total += v; }); $('#rubricTotal').textContent = Math.round(total); return Math.round(total); };
    RUBRIC.forEach((_, i) => { $(`#r${i}`).oninput = calc; });
    // 自動批改／AI 批改
    let lastAuto = null; let lastAI = null;
    const refreshSource = () => { $('#scoreSource').innerHTML = lastAI ? `紀錄將採用：<b>AI 批改 ${lastAI.pct} 分</b>` : lastAuto ? `紀錄將採用：<b>自動批改 ${lastAuto.pct} 分</b>` : '紀錄將採用：<b>手動自評</b>'; };
    $('#autoGrade').onclick = () => {
      const res = window.Grader.grade(ta.value, q.rubric, q);
      if (!res.ok) { lastAuto = null; $('#gradeResult').innerHTML = `<div class="note">${esc(res.reason)}</div>`; refreshSource(); return; }
      lastAuto = res; $('#gradeResult').innerHTML = renderGrade(res); refreshSource();
      $('#gradeResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    if ($('#aiGrade')) $('#aiGrade').onclick = async () => {
      if (ta.value.replace(/\s/g, '').length < 30) return toast('請先完成作答');
      const btn = $('#aiGrade'); btn.disabled = true; btn.textContent = '✨ AI 批改中…（約 20–60 秒）';
      try { const r = await aiGrade(q, ta.value); lastAI = { ...r, pct: Math.round(r.score / (q.score || 25) * 100) }; $('#aiResult').innerHTML = renderAI(lastAI, q); refreshSource(); }
      catch (e) { $('#aiResult').innerHTML = `<div class="note">AI 批改失敗：${esc(e.message)}</div>`; }
      btn.disabled = false; btn.textContent = '✨ AI 批改';
    };
    $('#saveAttempt').onclick = async () => {
      const graded = lastAI ? { self_score: lastAI.pct, graded_by: 'ai' } : lastAuto ? { self_score: lastAuto.pct, graded_by: 'auto' } : { self_score: calc(), graded_by: 'self' };
      await post('/attempts', { question_id: q.id, mode: 'practice', duration_sec: sec || null, ...graded, auto_score: lastAuto?.pct ?? null, ai_score: lastAI?.pct ?? null, rubric: RUBRIC.map(([, w], i) => Number($(`#r${i}`).value)), answer_text: ta.value || null, notes: $('#attemptNote').value || null });
      toast('已儲存練習紀錄'); localStorage.removeItem(`draft-${q.id}`); router();
    };
    $('#bmBtn').onclick = async () => { const r = await post('/bookmarks', { question_id: q.id }); toast(r.bookmarked ? '已收藏' : '已取消收藏'); router(); };
    $('#addTopic').onchange = async (e) => { if (e.target.value) { await post('/question-topics', { question_id: q.id, topic_id: Number(e.target.value) }); router(); } };
    app.querySelectorAll('[data-topic]').forEach((el) => { el.onclick = async () => { if (confirm('移除此考點標註？')) { await post('/question-topics', { question_id: q.id, topic_id: Number(el.dataset.topic), remove: true }); router(); } }; });
    $('#noteSave').onclick = async () => { const c = $('#noteInput').value.trim(); if (!c) return; await post('/notes', { ref_type: 'question', ref_id: q.id, content: c }); router(); };
    $('#ansSave').onclick = async () => { const c = $('#ansContent').value.trim(); if (!c) return toast('請輸入內容'); await post('/answers', { question_id: q.id, source_name: $('#ansSource').value.trim() || '自撰', source_url: $('#ansUrl').value.trim() || null, answer_type: 'outline', content: c }); toast('已加入解答'); router(); };
    app.querySelectorAll('[data-del-att]').forEach((b) => { b.onclick = async () => { await del(`/attempts/${b.dataset.delAtt}`); router(); }; });
    app.querySelectorAll('[data-del-note]').forEach((b) => { b.onclick = async () => { await del(`/notes/${b.dataset.delNote}`); router(); }; });
    app.querySelectorAll('[data-del-ans]').forEach((b) => { b.onclick = async () => { if (confirm('刪除此解答？')) { await del(`/answers/${b.dataset.delAns}`); router(); } }; });
    const tabs = $('#ansTabs'); if (tabs) tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => { tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); app.querySelectorAll('.ans-pane').forEach((p) => { p.style.display = p.dataset.src === b.dataset.src ? '' : 'none'; }); }; });
  }

  // ---------- 模擬考 ----------
  async function mock(_, params) {
    const subject = params.get('subject') || defaultPro();
    const n = Number(params.get('n') || 4);
    if (!params.get('start')) {
      app.innerHTML = `<h1>模擬考</h1><div class="card">
        <p>依考選部題型：申論題一科 4 題、每題 25 分、時間 2 小時。系統會從該科歷年題中抽出不同考點的題目組成一份考卷，交卷後系統會依得分要點自動批改打字作答的題目${aiConfig().endpoint ? '，並可一鍵送 AI 批改，由 AI 逐點給分、寫評語' : ''}；分數可再調整，並寫入學習紀錄。</p>
        <div class="row"><label>科目<br><select id="mSubject">${proOptions(subject)}</select></label>
          <label>題數<br><select id="mN">${[2, 3, 4, 5, 6].map((k) => `<option ${k === n ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label>時間（分）<br><input id="mMin" type="number" value="${n === 4 ? 120 : n * 30}" style="width:90px"></label>
          <button class="btn btn-accent" id="mStart">開始考試</button></div>
        <p class="small muted">考試中請勿切換頁面；作答內容會暫存在瀏覽器，重新整理不會消失。</p></div>`;
      $('#mStart').onclick = () => { location.hash = `#/mock?subject=${$('#mSubject').value}&n=${$('#mN').value}&min=${$('#mMin').value}&start=1`; };
      return;
    }
    const key = `mock-${subject}-${n}`;
    let exam = store.get(key, null);
    if (!exam || params.get('new')) { exam = await api(`/mock?subject=${subject}&n=${n}`); exam.startedAt = Date.now(); exam.minutes = Number(params.get('min') || 120); exam.answers = {}; store.set(key, exam); }
    const total = exam.minutes * 60;
    const aiOn = !!aiConfig().endpoint;
    exam.ai = exam.ai || {};
    const aiBox = (q, r) => renderAI({ ...r, pct: Math.round(r.score / q.score * 100) }, q);
    app.innerHTML = `
      <div class="card sticky-exam flex between"><div><b>${esc(exam.subject.name)}</b> 模擬考・${exam.questions.length} 題・${exam.minutes} 分</div>
        <div class="flex"><span class="timer" id="mTimer">--:--</span><button class="btn btn-sm" id="mNew">換一份</button><button class="btn btn-primary" id="mSubmit">交卷並批改</button></div></div>
      <p class="small muted">每題寫完可先按「🤖 自動批改」${aiOn ? '或「✨ AI 批改」' : ''}看結果；全部寫完再按「交卷並批改」彙整總分。</p>
      ${exam.questions.map((q) => { const c = mockCachedAI(exam, q); return `<div class="card"><div class="meta small muted">第 ${q.order} 題（${q.score} 分）・原為 ${roc(q.year)} 第 ${q.question_no} 題</div><div class="q-text">${esc(q.text)}</div>
        <textarea data-q="${q.id}" placeholder="作答區（亦可紙上作答）">${esc(exam.answers[q.id] || '')}</textarea>
        <div class="flex between"><div class="flex"><button class="btn btn-sm btn-accent" data-mauto="${q.id}">🤖 自動批改</button>${aiOn ? `<button class="btn btn-sm" data-mai="${q.id}">${c ? '✨ 重新 AI 批改' : '✨ AI 批改'}</button>` : ''}</div><span class="small muted" data-wc="${q.id}"></span></div>
        <div data-mres="${q.id}"></div><div data-mai-res="${q.id}">${c ? aiBox(q, c) : ''}</div></div>`; }).join('')}
      <div class="card flex between"><span class="muted small">交卷後會彙整各題${aiOn ? '自動批改與 AI 批改' : '自動批改'}分數；紀錄會以「mock」模式存入學習紀錄。</span><button class="btn btn-primary" id="mSubmit2">交卷並批改</button></div>`;
    const tEl = $('#mTimer');
    const h = setInterval(() => { const left = total - Math.floor((Date.now() - exam.startedAt) / 1000); tEl.textContent = left >= 0 ? fmtTime(left) : '-' + fmtTime(-left); tEl.classList.toggle('warn', left < 600); if (left === 0) toast('時間到，請交卷'); }, 500);
    window._mockTimer && clearInterval(window._mockTimer); window._mockTimer = h;
    const wc = (id) => { app.querySelector(`[data-wc="${id}"]`).textContent = `${(exam.answers[id] || '').replace(/\s/g, '').length} 字`; };
    app.querySelectorAll('textarea[data-q]').forEach((ta) => { ta.oninput = () => { exam.answers[ta.dataset.q] = ta.value; store.set(key, exam); wc(ta.dataset.q); }; wc(ta.dataset.q); });
    // 作答中即時批改：每題可先看自動批改或 AI 批改結果，AI 結果會留到交卷後沿用
    const qOf = (id) => exam.questions.find((q) => String(q.id) === String(id));
    app.querySelectorAll('[data-mauto]').forEach((b) => { b.onclick = async () => {
      const q = qOf(b.dataset.mauto); const full = await api(`/questions/${q.id}`);
      const res = window.Grader.grade(exam.answers[q.id] || '', full.rubric, { score: q.score });
      app.querySelector(`[data-mres="${q.id}"]`).innerHTML = res.ok ? renderGrade(res) : `<div class="note">${esc(res.reason)}</div>`;
    }; });
    app.querySelectorAll('[data-mai]').forEach((b) => { b.onclick = async () => {
      const q = qOf(b.dataset.mai); const ans = exam.answers[q.id] || ''; const box = app.querySelector(`[data-mai-res="${q.id}"]`);
      if (ans.replace(/\s/g, '').length < 30) return toast('請先作答（至少 30 字）再送 AI 批改');
      const full = await api(`/questions/${q.id}`);
      if (!full.rubric) return toast('本題尚未建立得分要點，無法 AI 批改');
      b.disabled = true; b.textContent = '✨ AI 批改中…（約 20–60 秒）';
      try { const r = await aiGrade({ ...full, score: q.score }, ans); exam.ai[q.id] = { answer: ans, result: r }; store.set(key, exam); box.innerHTML = aiBox(q, r); }
      catch (e) { box.innerHTML = `<div class="note">AI 批改失敗：${esc(e.message)}</div>`; }
      b.disabled = false; b.textContent = exam.ai[q.id] ? '✨ 重新 AI 批改' : '✨ AI 批改';
    }; });
    $('#mNew').onclick = () => { if (confirm('放棄目前考卷並重新抽題？')) location.hash = `#/mock?subject=${subject}&n=${n}&min=${exam.minutes}&start=1&new=1`; };
    const submit = () => grade(exam, key);
    $('#mSubmit').onclick = submit; $('#mSubmit2').onclick = submit;
  }
  // 作答中已做過的 AI 批改：作答內容沒再改動才沿用
  function mockCachedAI(exam, q) { const c = exam.ai && exam.ai[q.id]; return c && c.answer === (exam.answers[q.id] || '') ? c.result : null; }
  async function grade(exam, key) {
    clearInterval(window._mockTimer);
    const used = Math.floor((Date.now() - exam.startedAt) / 1000);
    // 逐題自動批改（有打字作答且該題有得分要點者）
    const auto = {}; const skip = {}; const fullQ = {}; const ai = {};
    exam.ai = exam.ai || {};
    for (const q of exam.questions) {
      const full = await api(`/questions/${q.id}`);
      fullQ[q.id] = { ...full, score: q.score };
      const ans = exam.answers[q.id];
      if (!ans || !ans.trim()) { skip[q.id] = '未在線上作答，請自行評分。'; continue; }
      const res = window.Grader.grade(ans, full.rubric, { score: q.score });
      if (res.ok) auto[q.id] = res; else skip[q.id] = res.reason;
    }
    const autoN = Object.keys(auto).length;
    const aiOn = !!aiConfig().endpoint;
    // 可送 AI 批改的題目：有得分要點且作答達 30 字；不能送的要說明原因，不要讓按鈕憑空消失
    const aiWhy = (q) => (!fullQ[q.id].rubric ? '本題尚未建立得分要點' : (exam.answers[q.id] || '').replace(/\s/g, '').length < 30 ? '線上作答滿 30 字才能送出' : '');
    const aiable = exam.questions.filter((q) => !aiWhy(q));
    app.innerHTML = `<h1>批改 — ${esc(exam.subject.name)} <span class="muted small">用時 ${fmtTime(used)}</span></h1>
      <div class="card flex between"><span class="small">${autoN ? `🤖 已自動批改 ${autoN} 題並帶入分數。` : '🤖 沒有可自動批改的題目（線上作答滿 30 字才會批改）。'}${aiOn ? (aiable.length ? '可再送 AI 批改，由 AI 逐點給分並寫評語，分數會改採 AI 結果。' : '✨ AI 批改同樣需要線上作答滿 30 字。') : ''}分數都可自行調整。</span>
        ${aiOn ? `<button class="btn btn-accent" id="aiAll" ${aiable.length ? '' : 'disabled title="沒有可送 AI 批改的題目"'}>✨ 全部 AI 批改（${aiable.length} 題）</button>` : ''}</div>
      ${exam.questions.map((q) => `<div class="card"><div class="small muted">第 ${q.order} 題（${q.score} 分）</div><div class="q-text" style="font-size:.95rem">${esc(q.text)}</div>
        ${exam.answers[q.id] ? `<details><summary>我的作答</summary><div class="note">${esc(exam.answers[q.id])}</div></details>` : ''}
        ${auto[q.id] ? `<details open><summary>🤖 自動批改結果：${auto[q.id].score}／${q.score} 分</summary>${renderGrade(auto[q.id])}</details>` : `<p class="small muted">未自動批改：${esc(skip[q.id] || '')}</p>`}
        <div data-ai="${q.id}"></div>
        <div class="flex" style="margin-top:.5rem">採計得分（0–${q.score}）<input type="number" min="0" max="${q.score}" step="0.5" value="${auto[q.id] ? auto[q.id].score : Math.round(q.score * 0.6)}" data-g="${q.id}" style="width:80px"> <span class="tag" data-src="${q.id}"></span>
          ${aiOn ? (aiable.includes(q) ? `<button class="btn btn-sm" data-ai-btn="${q.id}">✨ AI 批改</button>` : `<button class="btn btn-sm" disabled title="${esc(aiWhy(q))}">✨ AI 批改</button><span class="small muted">${esc(aiWhy(q))}</span>`) : ''}
          <a href="#/question/${q.id}" target="_blank">看得分要點與參考答案 ↗</a></div></div>`).join('')}
      <div class="card flex between"><span>總分：<span class="score-big" id="gTotal">0</span> / ${exam.questions.reduce((a, q) => a + q.score, 0)}</span><button class="btn btn-primary" id="gSave">儲存成績</button></div>`;
    const input = (id) => app.querySelector(`[data-g="${id}"]`);
    // 目前採計的分數來自哪裡：與 AI／自動批改分數相同才算，手動改過就是自行評分
    const source = (q) => { const g = Number(input(q.id).value) || 0; return ai[q.id] && Math.abs(g - ai[q.id].score) < 0.01 ? 'ai' : auto[q.id] && Math.abs(g - auto[q.id].score) < 0.01 ? 'auto' : 'self'; };
    const calc = () => {
      let t = 0;
      exam.questions.forEach((q) => { t += Number(input(q.id).value) || 0; const s = source(q); const el = app.querySelector(`[data-src="${q.id}"]`); el.textContent = s === 'ai' ? '採 AI 批改' : s === 'auto' ? '採自動批改' : '自行評分'; el.className = `tag ${s === 'ai' ? 'green' : s === 'auto' ? '' : 'amber'}`; });
      $('#gTotal').textContent = Math.round(t * 10) / 10;
    };
    app.querySelectorAll('[data-g]').forEach((i) => { i.oninput = calc; });
    const showAI = (q, r) => {
      ai[q.id] = { ...r, pct: Math.round(r.score / q.score * 100) };
      app.querySelector(`[data-ai="${q.id}"]`).innerHTML = `<details open><summary>✨ AI 批改結果：${r.score}／${q.score} 分</summary>${renderAI(ai[q.id], q)}</details>`;
      input(q.id).value = r.score;
      const btn = app.querySelector(`[data-ai-btn="${q.id}"]`); if (btn) btn.textContent = '✨ 重新 AI 批改';
    };
    // 作答中已送過 AI 批改且之後沒改答案的題目，直接沿用結果
    aiable.forEach((q) => { const r = mockCachedAI(exam, q); if (r) showAI(q, r); });
    calc();
    const runAI = async (q) => {
      const btn = app.querySelector(`[data-ai-btn="${q.id}"]`); const box = app.querySelector(`[data-ai="${q.id}"]`);
      if (!btn || btn.disabled) return false;
      btn.disabled = true; btn.textContent = '✨ 批改中…';
      box.innerHTML = '<p class="small muted">AI 批改中，約 20–60 秒…</p>';
      let ok = false;
      try {
        const r = await aiGrade(fullQ[q.id], exam.answers[q.id]);
        exam.ai[q.id] = { answer: exam.answers[q.id], result: r }; store.set(key, exam);
        showAI(q, r); calc(); ok = true;
      } catch (e) { box.innerHTML = `<div class="note">AI 批改失敗：${esc(e.message)}</div>`; }
      btn.disabled = false; btn.textContent = ai[q.id] ? '✨ 重新 AI 批改' : '✨ AI 批改';
      return ok;
    };
    app.querySelectorAll('[data-ai-btn]').forEach((b) => { b.onclick = () => runAI(exam.questions.find((q) => String(q.id) === b.dataset.aiBtn)); });
    if ($('#aiAll')) $('#aiAll').onclick = async () => {
      const todo = aiable.filter((q) => !ai[q.id]);
      if (!todo.length) return toast('可送的題目都已有 AI 批改結果，要重批請按各題的「重新 AI 批改」');
      const all = $('#aiAll'); all.disabled = true; all.textContent = '✨ AI 批改中…';
      const done = await Promise.all(todo.map(runAI));
      const n = done.filter(Boolean).length;
      toast(n === todo.length ? `AI 已批改 ${n} 題` : `AI 批改完成 ${n}／${todo.length} 題，失敗的題目可個別重試`);
      all.disabled = false; all.textContent = `✨ 全部 AI 批改（${aiable.length} 題）`;
    };
    $('#gSave').onclick = async () => {
      for (const q of exam.questions) {
        const g = Number(input(q.id).value) || 0;
        await post('/attempts', { question_id: q.id, mode: 'mock', duration_sec: Math.round(used / exam.questions.length), self_score: Math.round(g / q.score * 100), graded_by: source(q), auto_score: auto[q.id] ? auto[q.id].pct : null, ai_score: ai[q.id] ? ai[q.id].pct : null, answer_text: exam.answers[q.id] || null, notes: `模擬考 ${g}/${q.score}` });
      }
      localStorage.removeItem(key); toast('已儲存模擬考成績'); location.hash = '#/me';
    };
  }

  // ---------- 考點分析 ----------
  async function analysis(_, params) {
    const subject = params.get('subject') || defaultPro();
    const h = await api(`/heatmap?subject=${subject}`);
    const cell = {}; h.cells.forEach((c) => { cell[`${c.topic_id}-${c.year}`] = c; });
    const max = Math.max(1, ...h.cells.map((c) => c.n));
    const cls = (n) => n === 0 ? 'h0' : n / max < 0.3 ? 'h1' : n / max < 0.6 ? 'h2' : n / max < 0.9 ? 'h3' : 'h4';
    const topics = h.topics.filter((t) => t.total > 0);
    app.innerHTML = `<h1>考點分析</h1>
      <div class="card"><div class="row"><label>科目<br><select id="aSubject">${proOptions(subject)}</select></label><span class="small muted">熱度 = 該年度被標註到此考點的題數。${h.untagged ? `尚有 ${h.untagged} 題未標考點，` : ''}可在題目頁手動標註。</span></div></div>
      <div class="card heatmap">${topics.length ? `<table><tr><th class="topic">考點 ＼ 年度</th>${h.years.map((y) => `<th>${y}</th>`).join('')}<th>合計</th></tr>
        ${topics.map((t) => `<tr><th class="topic"><a href="#/questions?subject=${subject}&topic=${t.id}">${esc(t.name)}</a></th>${h.years.map((y) => { const c = cell[`${t.id}-${y}`]; return `<td class="cell ${cls(c?.n || 0)}">${c ? c.n : ''}</td>`; }).join('')}<td><b>${t.total}</b></td></tr>`).join('')}</table>` : '<p class="empty">此科尚無已標註考點的題目</p>'}</div>
      <div class="card"><h2 style="margin-top:0">考點排行</h2>${topics.slice(0, 15).map((t) => `<div class="flex" style="margin:.3rem 0"><span style="width:220px">${esc(t.name)}</span><div class="bar" style="flex:1"><span style="width:${t.total / (topics[0]?.total || 1) * 100}%"></span></div><b style="width:40px;text-align:right">${t.total}</b></div>`).join('')}</div>`;
    $('#aSubject').onchange = (e) => { location.hash = `#/analysis?subject=${e.target.value}`; };
  }

  // ---------- 猜題 ----------
  async function predict(_, params) {
    const subject = params.get('subject') || defaultPro();
    const p = await api(`/predictions?subject=${subject}`);
    const top = p.items.slice(0, 20);
    const maxS = top[0]?.score || 1;
    app.innerHTML = `<h1>猜題 <span class="muted small">目標年度：${roc(p.target_year)}</span></h1>
      <div class="card"><div class="row"><label>科目<br><select id="pSubject">${proOptions(subject)}</select></label>
        <div class="small muted">評分公式：近年出題頻率（0.8 年衰減）＋ 歷年總次數 ＋ 週期（連續 2–4 年未考的常考點）＋ 近兩年政策／修法熱度 ＋ 名師／人工猜題權重。分數僅供排序，不代表機率。</div></div></div>
      <div class="card">${top.map((t, i) => `<div class="pred-row"><div class="rank">${i + 1}</div><div>
          <div><a href="#/questions?subject=${subject}&topic=${t.topic_id}"><b>${esc(t.topic)}</b></a> ${t.policy_boost ? '<span class="tag amber">政策熱點</span>' : ''}${t.cycle_boost ? '<span class="tag purple">週期到了</span>' : ''}${t.manual.length ? '<span class="tag green">名師點名</span>' : ''}</div>
          <div class="explain">歷年 ${t.total} 題，近期權重 ${t.recent}；${t.last_year ? `最近一次 ${roc(t.last_year)}（隔 ${t.gap} 年）` : '尚未考過'}${t.policies.length ? '；相關政策：' + t.policies.map((x) => `<a href="#/policies?focus=${x.id}">${esc(x.title)}</a>`).join('、') : ''}</div>
          ${t.manual.map((m) => `<div class="angle small" style="margin-top:.3rem;background:#f3fbf6;border-left:3px solid var(--green);padding:.3rem .6rem;border-radius:4px"><b>${esc(m.title)}</b>${m.rationale ? '：' + esc(m.rationale) : ''} <span class="muted">（${esc(m.basis || '')}）</span></div>`).join('')}
          ${t.description ? `<div class="small muted">${esc(t.description)}</div>` : ''}</div>
          <div><div class="bar amber"><span style="width:${t.score / maxS * 100}%"></span></div><div class="small right">${t.score}</div></div></div>`).join('') || '<p class="empty">尚無資料</p>'}
        ${p.unlinked_manual.length ? `<h3>其他猜題（未對應考點）</h3>${p.unlinked_manual.map((m) => `<div class="q-item"><b>${esc(m.title)}</b><div class="small muted">${esc(m.rationale || '')}</div></div>`).join('')}` : ''}</div>`;
    $('#pSubject').onchange = (e) => { location.hash = `#/predict?subject=${e.target.value}`; };
  }

  // ---------- 政策動態 ----------
  async function policies(_, params) {
    const subject = params.get('subject') || ''; const cat = params.get('category') || ''; const q = params.get('q') || '';
    const cats = await api('/policy-categories');
    const rows = await api(`/policies?${new URLSearchParams({ ...(subject && { subject }), ...(cat && { category: cat }), ...(q && { q }) })}`);
    const focus = params.get('focus');
    app.innerHTML = `<h1>政策與修法動態 <span class="muted small">${rows.length} 則</span></h1>
      <div class="card"><div class="row"><label>科目<br><select id="poSubject">${subjectOptions(subject)}</select></label>
        <label>類別<br><select id="poCat"><option value="">全部</option>${cats.map((c) => `<option value="${esc(c.category)}" ${c.category === cat ? 'selected' : ''}>${esc(c.category || '未分類')}（${c.n}）</option>`).join('')}</select></label>
        <label>關鍵字<br><input id="poQ" value="${esc(q)}"></label><button class="btn btn-primary" id="poGo">篩選</button></div>
        <p class="small muted">每則附「可能考點」。考前請重點看近 18 個月且與你弱科相關的項目；標示「待查證」者請自行確認原始公文。</p></div>
      <div class="card"><div class="timeline">${rows.map((p) => `<div class="tl-item" id="p${p.id}" style="${String(p.id) === focus ? 'background:#fffbe6;border-radius:8px;padding:.4rem .6rem;margin-left:-.6rem' : ''}">
          <div class="date">${esc(p.date)} ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''} ${p.verified ? '' : '<span class="tag red">待查證</span>'} ${(p.subject_names || '').split('、').filter(Boolean).map((s) => `<span class="tag green">${esc(s)}</span>`).join('')}</div>
          <div class="title">${esc(p.title)}</div><div class="small">${esc(p.summary || '')}</div>
          ${p.exam_angle ? `<div class="angle">🎯 可能考點：${esc(p.exam_angle)}</div>` : ''}
          <div class="small muted">${p.topic_names ? '考點：' + esc(p.topic_names) + '　' : ''}${p.source_url ? `<a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.source_name || '來源')} ↗</a>` : esc(p.source_name || '')}</div></div>`).join('') || '<p class="empty">沒有符合的資料</p>'}</div></div>`;
    $('#poGo').onclick = () => { location.hash = `#/policies?${new URLSearchParams({ ...($('#poSubject').value && { subject: $('#poSubject').value }), ...($('#poCat').value && { category: $('#poCat').value }), ...($('#poQ').value && { q: $('#poQ').value }) })}`; };
    if (focus) setTimeout(() => $(`#p${focus}`)?.scrollIntoView({ block: 'center' }), 50);
  }

  // ---------- 法規 ----------
  async function laws() {
    const rows = await api('/laws');
    const cats = [...new Set(rows.map((r) => r.category || '其他'))];
    app.innerHTML = `<h1>法規與公報</h1><p class="small muted">條文以全國法規資料庫為準；本站僅收錄常考重點條文與考點提示，點進法規可看歷年考過的條號。</p>
      ${cats.map((c) => `<div class="card"><h2 style="margin-top:0">${esc(c)}</h2><table><tr><th>法規</th><th>最近修正</th><th>收錄條文</th><th>考過題數</th><th></th></tr>
        ${rows.filter((r) => (r.category || '其他') === c).map((r) => `<tr><td><a href="#/law/${r.id}"><b>${esc(r.name)}</b></a>${r.short_name ? `<span class="muted small">（${esc(r.short_name)}）</span>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${esc(r.last_amended || '—')}</td><td>${r.article_count}</td><td>${r.question_count}</td><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">全文 ↗</a>` : ''}</td></tr>`).join('')}</table></div>`).join('') || '<p class="empty">尚無法規資料</p>'}`;
  }
  async function law([id]) {
    const l = await api(`/laws/${id}`);
    app.innerHTML = `<p class="small"><a href="#/laws">← 法規列表</a></p><h1>${esc(l.name)} ${l.short_name ? `<span class="muted small">${esc(l.short_name)}</span>` : ''}</h1>
      <div class="card"><div class="flex">${l.category ? `<span class="tag">${esc(l.category)}</span>` : ''}${l.last_amended ? `<span class="tag amber">最近修正 ${esc(l.last_amended)}</span>` : ''}${l.url ? `<a class="btn btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">全國法規資料庫全文 ↗</a>` : ''}</div>${l.note ? `<p>${esc(l.note)}</p>` : ''}</div>
      <div class="grid grid-2"><div class="card"><h2 style="margin-top:0">重點條文 <span class="muted small">${l.articles.length} 條</span></h2>
        ${l.articles.map((a) => `<div class="q-item"><b>第 ${esc(a.article_no)} 條</b> ${a.title ? `<span class="muted">${esc(a.title)}</span>` : ''}<div style="white-space:pre-wrap">${esc(a.text)}</div>${a.exam_note ? `<div class="angle small" style="background:#fffaf0;border-left:3px solid var(--amber);padding:.3rem .6rem;margin-top:.3rem;border-radius:4px">🎯 ${esc(a.exam_note)}</div>` : ''}</div>`).join('') || '<p class="empty">尚未收錄條文，可於 db/seed/laws.json 補充</p>'}</div>
        <div class="card"><h2 style="margin-top:0">歷年考過</h2>${l.questions.map((q) => `<div class="small q-item">${qLink(q, `${roc(q.year)} ${esc(q.subject_name)} 第${q.question_no}題`)} ${q.article_no ? `<span class="tag">§${esc(q.article_no)}</span>` : ''}<div class="muted">${esc(q.snippet)}…</div></div>`).join('') || '<p class="empty">尚無對應題目</p>'}</div></div>`;
  }

  // ---------- 資料來源 / 補習班 ----------
  async function resources() {
    const rows = await api('/resources');
    const cats = [...new Set(rows.map((r) => r.category || '其他'))];
    app.innerHTML = `<h1>公開資料來源</h1><p class="small muted">估價師考試會考「現行」法規與市場資訊，這些是可直接查證、也可供程式自動蒐集的來源。</p>
      ${cats.map((c) => `<div class="card"><h2 style="margin-top:0">${esc(c)}</h2><table><tr><th>名稱</th><th>內容</th><th>API／開放資料</th><th>更新</th><th>對考生用途</th></tr>
        ${rows.filter((r) => (r.category || '其他') === c).map((r) => `<tr><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`}</td><td class="small">${esc(r.content || '')}</td><td class="small">${esc(r.api_or_opendata || '—')}</td><td class="small">${esc(r.update_frequency || '—')}</td><td class="small">${esc(r.use_for_students || '')}</td></tr>`).join('')}</table></div>`).join('') || '<p class="empty">尚無資料</p>'}`;
  }
  async function schools() {
    const rows = await api('/cram-schools');
    const li = (arr) => arr?.length ? `<ul class="small">${arr.map((x) => `<li>${typeof x === 'string' ? esc(x) : `<b>${esc(x.name || x.title || '')}</b>${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">↗</a>` : ''}${x.note || x.description ? `：${esc(x.note || x.description)}` : ''}`}</li>`).join('')}</ul>` : '<p class="small muted">—</p>';
    app.innerHTML = `<h1>補習班做法比較</h1><p class="small muted">整理各補習班的班別、教學方式與免費資源，作為本站功能設計與考生選班參考。價格與課程可能變動，請以官網為準。</p>
      <div class="grid grid-2">${rows.map((c) => `<div class="card school"><h3>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)} ↗</a>` : esc(c.name)}</h3>
        <b>班別與課程</b>${li(c.courses)}<b>教學方式</b>${li(c.methods)}<b>教材與免費資源</b>${li(c.materials)}
        ${c.pricing ? `<b>價格</b><p class="small">${esc(c.pricing)}</p>` : ''}${c.reviews ? `<b>學員評價</b><p class="small">${esc(c.reviews)}</p>` : ''}${c.notes ? `<p class="small muted">${esc(c.notes)}</p>` : ''}</div>`).join('') || '<p class="empty">尚無資料</p>'}</div>`;
  }

  // ---------- 讀書計畫 ----------
  async function plan(_, params) {
    const plans = await api('/study-plans');
    if (!plans.length) { app.innerHTML = '<h1>讀書計畫</h1><p class="empty">尚無計畫模板</p>'; return; }
    const sel = Number(params.get('id') || store.get('planId', plans[0].id));
    const p = plans.find((x) => x.id === sel) || plans[0];
    store.set('planId', p.id);
    const startKey = `planStart-${p.id}`; const start = store.get(startKey, null);
    const done = store.get(`planDone-${p.id}`, {});
    const curWeek = start ? Math.min(p.weeks, Math.max(1, Math.floor((Date.now() - new Date(start)) / 604800000) + 1)) : null;
    const total = p.plan.reduce((a, w) => a + (w.tasks?.length || 0), 0); const doneN = Object.values(done).filter(Boolean).length;
    app.innerHTML = `<h1>讀書計畫</h1>
      <div class="card"><div class="row"><label>模板<br><select id="plSel">${plans.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}（${x.weeks} 週）</option>`).join('')}</select></label>
        <label>開始日期<br><input type="date" id="plStart" value="${start || ''}"></label><button class="btn btn-sm" id="plReset">清除勾選</button></div>
        <p class="small">${esc(p.description || '')}</p>
        <div class="flex"><div class="bar green" style="flex:1"><span style="width:${total ? doneN / total * 100 : 0}%"></span></div><span class="small">${doneN}/${total} 項完成</span></div></div>
      ${p.plan.map((w, i) => `<div class="plan-week ${curWeek === i + 1 ? 'current' : ''}"><div class="flex between"><b>第 ${i + 1} 週　${esc(w.title || '')}</b>${curWeek === i + 1 ? '<span class="tag amber">本週</span>' : ''}</div>${w.focus ? `<div class="small muted">${esc(w.focus)}</div>` : ''}
        ${(w.tasks || []).map((t, k) => { const id = `${i}-${k}`; return `<div class="plan-task ${done[id] ? 'done' : ''}"><input type="checkbox" id="t${id}" data-id="${id}" ${done[id] ? 'checked' : ''}><label for="t${id}">${esc(t)}</label></div>`; }).join('')}</div>`).join('')}`;
    $('#plSel').onchange = (e) => { location.hash = `#/plan?id=${e.target.value}`; };
    $('#plStart').onchange = (e) => { store.set(startKey, e.target.value); router(); };
    $('#plReset').onclick = () => { if (confirm('清除本計畫所有勾選？')) { localStorage.removeItem(`planDone-${p.id}`); router(); } };
    app.querySelectorAll('input[data-id]').forEach((cb) => { cb.onchange = () => { done[cb.dataset.id] = cb.checked; store.set(`planDone-${p.id}`, done); cb.closest('.plan-task').classList.toggle('done', cb.checked); }; });
  }

  // ---------- 我的學習 ----------
  async function me() {
    const p = await api('/progress');
    app.innerHTML = `<h1>我的學習</h1>
      <div class="grid grid-2"><div class="card"><h2 style="margin-top:0">各科進度</h2>${p.by_subject.map((s) => `<div style="margin:.5rem 0"><div class="flex between"><span>${esc(s.name)}</span><span class="small muted">練過 ${s.practiced}/${s.total} 題・${s.attempts} 次・平均 ${s.avg_score ?? '—'}</span></div><div class="bar ${s.avg_score == null ? '' : s.avg_score < 60 ? 'red' : 'green'}"><span style="width:${s.total ? s.practiced / s.total * 100 : 0}%"></span></div></div>`).join('')}</div>
        <div class="card"><h2 style="margin-top:0">弱點考點（自評由低到高）</h2>${p.by_topic_weak.map((t) => `<div class="flex between q-item"><span><a href="#/questions?topic=${t.id}&subject=">${esc(t.name)}</a> <span class="small muted">${esc(t.subject_name)}</span></span><span class="tag ${t.avg_score < 60 ? 'red' : 'green'}">${t.avg_score}</span></div>`).join('') || '<p class="empty">還沒有練習紀錄</p>'}</div></div>
      <div class="grid grid-2"><div class="card"><h2 style="margin-top:0">最近練習</h2><table><tr><th>時間</th><th>題目</th><th>模式</th><th>自評</th></tr>${p.recent.map((a) => `<tr><td class="small">${esc(a.started_at.slice(0, 16))}</td><td class="small">${qLink(a, `${roc(a.year)} ${esc(a.subject_name.replace('不動產', ''))} 第${a.question_no}題`)}</td><td class="small">${esc(a.mode)}</td><td>${a.self_score ?? '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">無</td></tr>'}</table></div>
        <div class="card"><h2 style="margin-top:0">收藏題目</h2>${p.bookmarks.map((b) => `<div class="q-item small">${qLink(b)}<div class="muted">${esc(b.snippet)}…</div></div>`).join('') || '<p class="empty">尚無收藏</p>'}
          <h2>每日練習量</h2><div class="flex" style="gap:3px;align-items:flex-end;height:60px">${[...p.daily].reverse().map((d) => `<div title="${d.day}：${d.n} 次" style="width:10px;background:var(--navy);height:${Math.min(100, d.n * 15)}%;border-radius:2px"></div>`).join('') || '<span class="muted small">無</span>'}</div></div></div>
      <div class="card"><h2 style="margin-top:0">備份與同步</h2>
        <p class="small muted">學習紀錄、收藏、筆記、自撰解答只存在這個瀏覽器。換裝置或清除瀏覽資料前請先匯出；匯入會覆蓋目前資料。</p>
        <div class="flex"><button class="btn" id="expUser">⬇ 匯出學習資料（JSON）</button><label class="btn">⬆ 匯入學習資料 <input type="file" id="impUser" accept="application/json" style="display:none"></label><button class="btn btn-danger" id="resetUser">清除所有學習資料</button></div></div>`;
    $('#expUser').onclick = async () => {
      const data = await api('/user-export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `estimator-exam-learning-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    };
    $('#impUser').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const data = JSON.parse(await f.text()); if (!data || typeof data !== 'object' || !Array.isArray(data.attempts)) throw new Error('格式不符'); if (confirm('匯入會覆蓋目前的學習資料，確定？')) { await post('/user-import', data); toast('已匯入'); router(); } }
      catch (err) { toast('匯入失敗：' + err.message); }
    };
    $('#resetUser').onclick = async () => { if (confirm('確定清除此瀏覽器的所有學習資料？此動作無法復原。')) { await post('/user-reset', {}); toast('已清除'); router(); } };
  }

  // ---------- 搜尋 ----------
  async function search(_, params) {
    const q = params.get('q') || '';
    const r = q ? await api(`/search?q=${encodeURIComponent(q)}`) : {};
    const sec = (title, items, fn) => `<div class="card"><h2 style="margin-top:0">${title} <span class="muted small">${items?.length || 0}</span></h2>${(items || []).map(fn).join('') || '<p class="empty">無</p>'}</div>`;
    app.innerHTML = `<h1>搜尋「${esc(q)}」</h1>
      ${sec('題目', r.questions, (x) => `<div class="q-item small">${qLink(x, `${roc(x.year)} ${esc(x.subject_name)} 第${x.question_no}題`)}<div class="muted">${esc(x.snippet)}…</div></div>`)}
      ${sec('考點', r.topics, (x) => `<a class="tag clickable" href="#/questions?subject=${x.subject_code}&topic=${x.id}">${esc(x.name)}（${esc(x.subject_name)}）</a>`)}
      ${sec('政策動態', r.policies, (x) => `<div class="q-item small"><span class="muted">${esc(x.date)}</span> <a href="#/policies?focus=${x.id}">${esc(x.title)}</a><div class="muted">${esc(x.snippet || '')}</div></div>`)}
      ${sec('法條', r.articles, (x) => `<div class="q-item small"><a href="#/law/${x.law_id}">${esc(x.law_name)} 第 ${esc(x.article_no)} 條</a><div class="muted">${esc(x.snippet)}…</div></div>`)}`;
  }

  // ---------- 申論答題法 ----------
  function guide() {
    app.innerHTML = `<h1>申論答題法</h1>${md(GUIDE_MD)}`;
  }
  const GUIDE_MD = `
## 一、考試形式與時間配置
- 七科**全部申論**（考試規則第 6 條）：國文（作文）2 題各 50 分；六專業科每科 4 題各 25 分（估價實務為 2–4 大題合計 100 分）。
- 時間：除**不動產估價實務 4 小時、可用電子計算器**外，其餘各科 2 小時；估價理論**禁用計算器**。
- 及格：總成績 = 國文×10% ＋ 專業六科平均×90%，須滿 60；任一科 0 分或專業平均未滿 50 不及格。
- 配置：每題 **25 分鐘**，預留 10–20 分鐘；先看完整張考卷，從最有把握的題目下筆；**不要提早交卷**（有上榜者鈴響前改對一題拿滿分）。
- 字數：每題 600–900 字、約 1.5–2 頁。寫滿，字數與分數大致成正比；但字跡潦草、刪改過多會失分。

## 二、答題架構（高點、公職王、考生心得共同強調）
**三段論法**：大前提（法條／定義／學說）→ 小前提（套用題目事實）→ 結論。細部五段：
1. **破題／定義**：一句話點出核心概念，引用法規定義（如技術規則第 2 條用語）。
2. **法條依據**：寫條號與要旨：「依不動產估價技術規則第 X 條規定…」。條號記不準寧可寫「依技術規則規定」，不要寫錯。
3. **分析／學說**：**題目有幾個問號就寫幾個小標**，(一)(二)(三) 條列，先原則再例外；有餘裕再加學者見解、判例、時事、個人看法。
4. **實務／計算／案例**：公式 → 代入數字 → 步驟 → 單位 → 結果；法規題用實務運作或釋字補強。
5. **結論**：回應題目問句，簡短有力；有爭議要表態並說明理由。
補習班詳解的固定格式可直接當自評對照：**試題評析 → 破題關鍵 → 使用法條／學說 → 考點命中 → 擬答**。

## 三、各科作答重點（含歷年心得）
- **不動產估價理論**：範圍最小（技術規則 140 條）、CP 值最高。五大題型：觀念題、方法題、計算題（成本法定額／定率、土開法、地價分配率）、專有名詞、考古題。**名詞要精準**：有人把「限定價格」寫成「特定價格」只拿 12 分。
- **不動產估價實務**：背報告書格式與各方法「應敘明事項」（技術規則第 15–17 條）；先說明選用方法的理由；**不自行假設題目沒給的條件**；每步驗算寫完整（文字＋公式＋計算）。題型年年變：租金估價、報告書挑錯、徵收、三法計算、權變流程。
- **不動產經濟學**：**一定畫圖**並解釋每條線的成因；可與擬答不同但要說得通。必備圖：競租、寇斯、從價／從量稅、屠能圈、差額地租、供需與蛛網。用字貼近課本，評分嚴。
- **不動產投資分析**：六大財務公式、NPV／IRR、CAPM、證券化；每年約 2 題計算＋論述增加（ESG、綠色金融）。先列公式再帶入，最後解釋決策意涵。切忌第一題花 45 分鐘。
- **民法物權與不動產法規**：七種題型（法條／綜合／申論／比較／評論／實例／計算）。高頻：時效取得、越界建築、§767、共有與土地法 §34-1、地上權／區分地上權、抵押權；估價師法（釋字 809、§9 一處事務所、§41 價格差異協調、助理員制度）；土增稅免徵／不課徵。
- **土地利用法規**：分「計畫法規」與「開發利用法規」兩層。**徵收每年一題**；都更、國土計畫 vs 區域計畫 vs 都市計畫比較、市地重劃、容積移轉、危老、非都管制、當年修法。

## 四、閱卷者視角的失分原因
- 題意判讀錯誤、答非所問；沒有小標與分點。
- 名詞誤用、條次誤引（第二項寫成第一項）、引用已修正的舊法。
- 計算題只寫答案不寫過程；自行添加估價條件。
- 冷門未準備：市地重劃、估價師法、農作改良物、釋字 809、危老條例。
- 時間失控、字跡潦草；「讀懂」不等於「讀精」。

## 五、階段式練習法與本站循環
1. 讀擬答做簡摘 → 2. 看題寫簡摘並朗讀 → 3. 限時手寫 → 4. 對照擬答自評。經濟學畫圖、投資計算務必**手寫**。
- 〈讀書計畫〉選模板並設開始日期；以戰養戰者可先考經紀人、地政士。
- 每天〈歷年題庫〉1–2 題計時作答、用量表自評、記失分原因；每週一科〈模擬考〉。
- 考前兩個月看〈猜題〉與〈政策動態〉，整理「修法前後比較表」；考前一週只看收藏題、弱點題、法條卡片。
`;

  // ---------- 關於 ----------
  async function about() {
    const o = await api('/overview');
    const examDate = store.get('examDate', DEFAULT_EXAM_DATE);
    app.innerHTML = `<h1>關於本站／資料說明</h1>
      <div class="card"><h2 style="margin-top:0">設定</h2><label>考試日期（用於倒數）<br><input type="date" id="examDate" value="${esc(examDate)}"></label> <button class="btn btn-sm" id="saveDate">儲存</button>
        <span class="small muted">　每年 8 月中旬連考三天、5 月中旬報名、10 月中旬榜示；116 年預定 116/8/21–8/23 考試、116/5/18–5/27 報名（以考選部公告為準）。</span></div>
      <div class="card"><h2 style="margin-top:0">考試制度速覽</h2>
        <table><tr><th>節次</th><th>科目</th><th>時間</th><th>配分</th><th>計算器</th></tr>
          <tr><td>第 1 天 09:00</td><td>國文（作文）</td><td>2 小時</td><td>2 題各 50 分，占總成績 10%</td><td>禁止</td></tr>
          <tr><td>第 1 天 13:00</td><td>民法物權與不動產法規</td><td>2 小時</td><td>4 題各 25 分</td><td>禁止</td></tr>
          <tr><td>第 1 天 15:40</td><td>土地利用法規</td><td>2 小時</td><td>4 題各 25 分</td><td>禁止</td></tr>
          <tr><td>第 2 天 09:00</td><td>不動產投資分析</td><td>2 小時</td><td>4 題各 25 分</td><td>可以</td></tr>
          <tr><td>第 2 天 13:00</td><td>不動產估價實務</td><td><b>4 小時</b></td><td>2–4 大題合計 100 分</td><td>可以</td></tr>
          <tr><td>第 3 天 09:00</td><td>不動產經濟學</td><td>2 小時</td><td>4 題各 25 分</td><td>禁止</td></tr>
          <tr><td>第 3 天 13:00</td><td>不動產估價理論</td><td>2 小時</td><td>4 題各 25 分</td><td>禁止</td></tr></table>
        <p class="small">及格方式（考試規則第 9 條）：總成績 = 國文×10% ＋ 專業六科平均×90%，滿 60 分及格；任一科 0 分或專業平均未滿 50 分不及格。首次考試為 90 年 12 月；101–115 年及格率 2.7%–24.1%。
          命題大綱：<a href="https://wwwc.moex.gov.tw/main/content/wHandMenuFile.ashx?file_id=2068" target="_blank" rel="noopener">考選部 PDF ↗</a>（107 年修正民法物權與不動產法規、土地利用法規、不動產估價實務）。</p>
        <table>${o.by_subject.filter((s) => s.code !== 'chinese').map((s) => `<tr><td style="width:180px"><b>${esc(s.name)}</b></td><td class="small">${esc(state.subjects.find((x) => x.code === s.code)?.description || '')}</td></tr>`).join('')}</table></div>
      <div class="card"><h2 style="margin-top:0">自動批改說明</h2>
        <ul><li><b>自動批改（內建、免費）</b>：依每題「得分要點」比對作答。計分＝得分要點涵蓋 70%（計算題含數值比對）＋法條引用 12%＋架構 10%＋篇幅 8%；無應引法條的題目，要點占 80%、架構 12%。只列關鍵詞而沒有論述會折減。</li>
          <li>它檢查的是「有沒有寫到」，無法判斷論述對錯；請當成檢核表使用，再對照得分要點與補習班解答。</li>
          <li><b>AI 批改（選用）</b>：由站方部署 Supabase Edge Function 後啟用，逐點給分並寫評語。若站方已設定，題目頁會出現「AI 批改」按鈕；也可在下方填入自己的端點。</li></ul>
        <div class="row"><label>AI 批改端點網址<br><input id="aiEndpoint" style="width:340px" placeholder="https://xxxx.supabase.co/functions/v1/grade" value="${esc(store.get('aiEndpoint', '') || (window.APP_CONFIG || {}).aiEndpoint || '')}"></label>
          <label>公開金鑰（Supabase anon／publishable key，選填）<br><input id="aiKey" style="width:260px" value="${esc(store.get('aiKey', '') || (window.APP_CONFIG || {}).aiAnonKey || '')}"></label>
          <button class="btn btn-sm" id="saveAI">儲存</button></div></div>
      <div class="card"><h2 style="margin-top:0">資料來源與版權</h2>
        <ul><li><b>歷年試題</b>：考選部「歷年考畢試題」為公開資料。本站收錄 ${o.year_min ? roc(o.year_min) + '–' + roc(o.year_max) : '—'} 共 ${o.questions} 題，標示「待核對」者表示尚未逐字比對原卷。</li>
        <li><b>補習班答案</b>：補習班考後解答屬各機構著作，本站每題提供原始連結與少數「解題要點」摘要，不整篇轉載。</li>
        <li><b>得分要點</b>：本站依現行法規與通說為每題撰寫的原創評分依據，非考選部或補習班公布之標準答案。</li>
        <li><b>法規</b>：以全國法規資料庫為準，本站僅收錄常考重點條文。</li>
        <li><b>政策動態</b>：整理自內政部、財政部、中央銀行、公會公告與新聞。標示「待查證」者請自行確認原始文件。</li>
        <li><b>猜題</b>：系統依出題頻率、週期與政策熱度計算排序，加上人工／名師猜題，僅供規劃讀書優先順序。</li></ul>
        <h2>如何擴充資料</h2>
        <p class="small">所有資料來自 <code>db/seed/*.json</code>，修改後執行 <code>npm run init</code> 重新匯入（學習紀錄不會被清除）。抓取考選部試題：<code>npm run fetch:moex</code>。詳見 README.md。</p></div>`;
    $('#saveDate').onclick = () => { store.set('examDate', $('#examDate').value); toast('已儲存'); updateCountdown(); };
    $('#saveAI').onclick = () => { store.set('aiEndpoint', $('#aiEndpoint').value.trim()); store.set('aiKey', $('#aiKey').value.trim()); toast('已儲存 AI 批改設定'); };
  }
  function updateCountdown() { const d = store.get('examDate', DEFAULT_EXAM_DATE); $('#examCountdown').textContent = d ? `距 ${d} 考試 ${daysTo(d)} 天` : ''; }

  // ---------- 啟動 ----------
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`; };
  window.addEventListener('hashchange', router);
  (async () => { state.subjects = await api('/subjects'); updateCountdown(); router(); })();
})();

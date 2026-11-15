/* 自動批改引擎（純前端、規則式）
   依每題「得分要點」比對作答：要點涵蓋 → 法條引用 → 計算結果 → 架構 → 篇幅。
   僅能檢查「有沒有寫到」，無法判斷論述是否正確，結果供自我檢核。 */
(() => {
  const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cnToInt(s) {
    if (/^\d+$/.test(s)) return Number(s);
    let total = 0; let cur = 0;
    for (const ch of s) {
      if (ch in CN) cur = CN[ch];
      else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
      else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
      else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
      else return NaN;
    }
    return total + cur;
  }

  // 正規化：全形→半形、去空白、臺→台、小寫、去千分位
  function norm(s) {
    return String(s || '').normalize('NFKC').replace(/臺/g, '台').replace(/\s+/g, '').replace(/(\d),(?=\d{3})/g, '$1').toLowerCase();
  }

  // 抽出作答中引用的條號，例如 第43條、第四十七條之四、§841-5、第 841 條之 5
  function citedArticles(raw) {
    const t = String(raw || '').normalize('NFKC').replace(/\s+/g, '');
    const out = new Set();
    const num = '[0-9一二三四五六七八九十百千零〇兩]+';
    const re1 = new RegExp(`第(${num})條(?:之(${num}))?`, 'g');
    let m;
    while ((m = re1.exec(t))) { const a = cnToInt(m[1]); const b = m[2] ? cnToInt(m[2]) : null; if (!Number.isNaN(a)) out.add(b ? `${a}-${b}` : String(a)); }
    const re2 = /§+(\d+)(?:[-之](\d+))?/g;
    while ((m = re2.exec(t))) out.add(m[2] ? `${m[1]}-${m[2]}` : m[1]);
    const re3 = /(\d+)條之(\d+)/g;
    while ((m = re3.exec(t))) out.add(`${m[1]}-${m[2]}`);
    return out;
  }

  const LAW_ALIASES = {
    不動產估價技術規則: ['技術規則', '估價技術規則'], 不動產估價師法: ['估價師法'], 土地徵收補償市價查估辦法: ['市價查估辦法', '查估辦法'],
    平均地權條例: ['平權條例', '平均地權'], 都市更新條例: ['都更條例'], 都市更新權利變換實施辦法: ['權利變換實施辦法', '權變實施辦法'],
    都市危險及老舊建築物加速重建條例: ['危老條例'], 土地徵收條例: ['徵收條例'], 非都市土地使用管制規則: ['非都管制規則', '非都市土地使用管制'],
    都市計畫容積移轉實施辦法: ['容積移轉實施辦法', '容移辦法'], 公寓大廈管理條例: ['公寓大廈條例'], 不動產經紀業管理條例: ['經紀業管理條例', '經紀業條例'],
  };

  // 抽出作答中的數字（含 萬／億 換算、百分比）
  function numbersIn(raw) {
    const t = String(raw || '').normalize('NFKC').replace(/[−–—﹣]/g, '-').replace(/(\d),(?=\d{3})/g, '$1');
    const out = [];
    let m;
    const reC = /(\d+(?:\.\d+)?)億(\d+(?:\.\d+)?)萬/g; // 例：1億2,345萬
    while ((m = reC.exec(t))) out.push(Number(m[1]) * 1e8 + Number(m[2]) * 1e4);
    const re = /(-?\d+(?:\.\d+)?)\s*(億|萬|%|％)?/g;
    while ((m = re.exec(t))) {
      const v = Number(m[1]); if (Number.isNaN(v)) continue;
      out.push(v);
      if (m[2] === '萬') out.push(v * 1e4);
      if (m[2] === '億') out.push(v * 1e8);
      if (m[2] === '%' || m[2] === '％') out.push(v / 100);
    }
    return out;
  }
  function numberHit(nums, ans) {
    const tol = ans.tolerance ?? 0.01; const target = Number(ans.value);
    if (Number.isNaN(target)) return false;
    const cands = [target];
    if (ans.unit && /%|％/.test(ans.unit)) cands.push(target * 100, target / 100);
    if (Math.abs(target) >= 1e4) cands.push(target / 1e4); // 以「萬元」為單位作答
    return nums.some((n) => cands.some((c) => (c === 0 ? Math.abs(n) < 1e-9 : Math.abs(n - c) / Math.abs(c) <= tol)));
  }

  const HEADING_RE = /(^|\n)\s*(?:[（(][一二三四五六七八九十0-9]+[）)]|[一二三四五六七八九十壹貳參肆伍]+[、．.]|\d+[.、．)]|[⑴-⒇①-⑳])/g;
  const CONCLUSION_RE = /結論|綜上|小結|綜合以上|總結|因此|是以|準此|職是|故[，,]/;

  function grade(answer, rubric, question) {
    const max = question?.score || 25;
    const raw = String(answer || '');
    const text = norm(raw);
    const len = raw.replace(/\s/g, '').length;
    const isCalc = !!(rubric?.answers && rubric.answers.length);
    const targetLen = Math.round(max * (isCalc ? 12 : 24));
    if (!rubric || !Array.isArray(rubric.points) || !rubric.points.length) return { ok: false, reason: '本題尚未建立得分要點，無法自動批改。' };
    if (len < 30) return { ok: false, reason: '作答內容太短（少於 30 字），請先完成作答再批改。' };

    // 1. 得分要點
    const totalW = rubric.points.reduce((a, p) => a + (p.weight || 0), 0) || 100;
    const points = rubric.points.map((p) => {
      const groups = (p.keywords || []).map((g) => String(g).split('|').map((x) => norm(x)).filter(Boolean)).filter((g) => g.length);
      const hits = []; const misses = [];
      groups.forEach((alts, i) => { const found = alts.find((a) => text.includes(a)); if (found) hits.push(found); else misses.push(String(p.keywords[i]).split('|')[0]); });
      const need = Math.max(1, Math.min(groups.length || 1, p.min_hits || Math.ceil((groups.length || 1) * 0.6)));
      // 達到門檻給七成，其餘三成看詞組命中比例，寫得越完整越接近滿分
      const cov = groups.length ? 0.7 * Math.min(1, hits.length / need) + 0.3 * (hits.length / groups.length) : 0;
      return { title: p.title, weight: (p.weight || 0) / totalW * 100, cov, hits, misses, note: p.note || '', status: hits.length >= need ? 'full' : hits.length > 0 ? 'partial' : 'miss' };
    });
    let content = points.reduce((a, p) => a + p.weight * p.cov, 0) / 100;

    // 2. 計算結果
    let calc = null;
    if (isCalc) {
      const nums = numbersIn(raw);
      const items = rubric.answers.map((a) => ({ label: a.label, value: a.value, unit: a.unit || '', hit: numberHit(nums, a) }));
      calc = { items, score: items.filter((x) => x.hit).length / items.length };
      content = 0.55 * content + 0.45 * calc.score;
    }
    // 只列關鍵詞、沒有論述 → 折減
    const depth = Math.max(0.2, Math.min(1, len / (targetLen * 0.5)));
    const contentEff = content * depth;

    // 3. 法條引用
    let law = null;
    // laws_optional：經濟學、投資分析等科目，法條僅作提示不計分
    const lawList = rubric.laws_optional ? [] : (rubric.laws || []).filter((l) => l && l.law);
    if (lawList.length) {
      const cited = citedArticles(raw);
      const wanted = []; lawList.forEach((l) => (l.articles || []).forEach((a) => wanted.push({ law: l.law, article: String(a) })));
      const got = wanted.filter((w) => cited.has(w.article));
      const named = lawList.filter((l) => [l.law, ...(LAW_ALIASES[l.law] || [])].some((n) => text.includes(norm(n))));
      let s;
      if (wanted.length) { const need = Math.max(1, Math.ceil(wanted.length * 0.5)); s = Math.min(1, got.length / need) * 0.8 + (named.length ? 0.2 : 0); if (!got.length && named.length) s = 0.3; }
      else s = named.length ? 1 : 0;
      law = { score: s, wanted, got, missing: wanted.filter((w) => !cited.has(w.article)), named: named.map((l) => l.law), cited: [...cited] };
    }

    // 4. 架構
    const headingCount = (raw.match(HEADING_RE) || []).length;
    const needHeadings = Math.max(2, rubric.sub_questions || 2);
    const headingScore = Math.min(1, headingCount / needHeadings);
    const tail = raw.slice(Math.floor(raw.length * 0.7));
    const hasConclusion = CONCLUSION_RE.test(tail);
    const structure = { score: headingScore * 0.6 + (hasConclusion ? 0.4 : 0), headingCount, needHeadings, hasConclusion };

    // 5. 篇幅
    const length = { score: Math.min(1, len / targetLen), len, target: targetLen };

    // 加權
    const W = law ? { content: 0.70, law: 0.12, structure: 0.10, length: 0.08 } : { content: 0.80, law: 0, structure: 0.12, length: 0.08 };
    const pct = contentEff * W.content + (law ? law.score * W.law : 0) + structure.score * W.structure + length.score * W.length;
    const score = Math.round(pct * max * 2) / 2;

    // 回饋
    const tips = [];
    const missed = points.filter((p) => p.status === 'miss'); const partial = points.filter((p) => p.status === 'partial');
    if (missed.length) tips.push(`漏掉 ${missed.length} 個得分點：${missed.map((p) => `「${p.title}」`).join('、')}。`);
    if (partial.length) tips.push(`${partial.length} 個得分點只寫到一部分，可補上：${partial.slice(0, 3).map((p) => `${p.title}（${p.misses.slice(0, 3).join('、')}）`).join('；')}。`);
    if (calc && calc.score < 1) tips.push(`計算結果有 ${calc.items.filter((x) => !x.hit).length} 項未出現或與參考值不符：${calc.items.filter((x) => !x.hit).map((x) => x.label).join('、')}。請檢查公式與代入數字。`);
    if (law && law.missing.length) tips.push(`建議引用條文：${law.missing.slice(0, 5).map((w) => `${w.law}第 ${w.article} 條`).join('、')}。條號沒把握時至少寫出法規名稱。`);
    if (structure.headingCount < structure.needHeadings) tips.push(`本題約有 ${rubric.sub_questions || needHeadings} 個子問，建議至少 ${needHeadings} 個小標（一、二、或（一）（二）），目前偵測到 ${headingCount} 個。`);
    if (!structure.hasConclusion) tips.push('結尾沒有偵測到結論句，請以「綜上」「結論」回應題目問句。');
    if (length.score < 0.7) tips.push(`篇幅偏短（${len} 字），本題建議約 ${targetLen} 字以上。`);
    if (depth < 0.85) tips.push('關鍵詞有出現但論述篇幅不足，內容分已折減；請把每個要點展開說明。');
    if (rubric.laws_optional && (rubric.laws || []).length) tips.push(`可視情況引用相關法規加分（本科不計入法條分數）：${rubric.laws.map((l) => l.law + ((l.articles || []).length ? ' 第 ' + l.articles.join('、') + ' 條' : '')).join('；')}。`);
    if (rubric.figure) tips.push(`本題應畫圖：${rubric.figure}。線上無法畫圖，請至少用文字說明圖形的軸、曲線與移動方向。`);
    const band = pct >= 0.8 ? '優' : pct >= 0.6 ? '及格' : pct >= 0.4 ? '待加強' : '不足';

    return {
      ok: true, max, score, pct: Math.round(pct * 100), band, isCalc,
      parts: [
        { key: 'content', label: isCalc ? '得分要點＋計算結果' : '得分要點涵蓋', weight: W.content, score: contentEff },
        ...(law ? [{ key: 'law', label: '法條引用', weight: W.law, score: law.score }] : []),
        { key: 'structure', label: '架構（小標與結論）', weight: W.structure, score: structure.score },
        { key: 'length', label: '篇幅', weight: W.length, score: length.score },
      ],
      points, calc, law, structure, length, depth, tips,
    };
  }

  window.Grader = { grade, norm, citedArticles, numbersIn };
})();

// 從全國法規資料庫（law.moj.gov.tw）抓取法規條文，寫入 db/seed/laws.json 的 articles 欄位
// 用法：node scripts/fetch-laws.js            → 更新 laws.json 內所有有 pcode 或 name 的法規
//       node scripts/fetch-laws.js 不動產估價技術規則   → 只更新指定法規
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.join(__dirname, '..', 'db', 'seed', 'laws.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const decode = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/　/g, ' ').replace(/[ \t]+\n/g, '\n').trim();

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function findPcode(name) {
  const html = await get(`https://law.moj.gov.tw/Law/LawSearchResult.aspx?ty=ONEBAR&kw=${encodeURIComponent(name)}`);
  const re = /LawAll\.aspx\?pcode=([A-Z0-9]+)"[^>]*>([^<]+)</gi;
  let m; const found = [];
  while ((m = re.exec(html))) found.push({ pcode: m[1], title: decode(m[2]) });
  const exact = found.find((f) => f.title.replace(/\s/g, '') === name.replace(/\s/g, ''));
  return (exact || found[0])?.pcode || null;
}

async function fetchLaw(pcode) {
  const html = await get(`https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`);
  const amended = html.match(/修正日期[^<]*<\/th>\s*<td[^>]*>\s*([^<]+)/)?.[1]?.trim() || html.match(/(民國\s*\d+\s*年\s*\d+\s*月\s*\d+\s*日)/)?.[1] || null;
  const articles = [];
  const re = /<div class="col-no">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>\s*<\/div>\s*<div class="col-data">([\s\S]*?)<\/div>\s*<\/div>\s*(?=<div class="row">|<\/div>|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const no = m[1].replace(/\s/g, '').replace(/^第|條$/g, '');
    const body = decode(m[2].replace(/<div class="line-\d{4}">/g, '\n'));
    if (body) articles.push({ article_no: no, text: body });
  }
  if (!articles.length) { // 備援：寬鬆比對
    const re2 = /第\s*([0-9\-]+)\s*條<\/a>[\s\S]*?<div class="law-article">([\s\S]*?)<\/div>\s*<\/div>/g;
    while ((m = re2.exec(html))) articles.push({ article_no: m[1], text: decode(m[2]) });
  }
  return { amended, articles };
}

const laws = JSON.parse(fs.readFileSync(SEED, 'utf8').replace(/^﻿/, ''));
const only = process.argv[2];
let updated = 0;
for (const law of laws) {
  if (only && law.name !== only && law.short_name !== only) continue;
  try {
    if (!law.pcode) law.pcode = await findPcode(law.name);
    if (!law.pcode) { console.warn(`找不到法規代碼：${law.name}`); continue; }
    law.url = `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${law.pcode}`;
    const { amended, articles } = await fetchLaw(law.pcode);
    if (amended) law.last_amended = amended;
    if (articles.length) {
      const notes = Object.fromEntries((law.articles || []).map((a) => [String(a.article_no), a]));
      law.articles = articles.map((a) => ({ ...a, title: notes[a.article_no]?.title ?? null, exam_note: notes[a.article_no]?.exam_note ?? null }));
      // 保留 seed 中原本有考點提示但未在抓到條文中的條目
      for (const [no, a] of Object.entries(notes)) if (!law.articles.some((x) => x.article_no === no) && a.text) law.articles.push(a);
      console.log(`${law.name}：${articles.length} 條（${amended || '修正日期未知'}）`);
      updated++;
    } else console.warn(`${law.name}：抓到 0 條，網頁結構可能改變`);
  } catch (e) { console.warn(`${law.name}：${e.message}`); }
  await new Promise((r) => setTimeout(r, 800));
}
fs.writeFileSync(SEED, JSON.stringify(laws, null, 2), 'utf8');
console.log(`已更新 ${updated} 部法規 → ${SEED}`);

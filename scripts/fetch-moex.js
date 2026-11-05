// 從考選部「考畢試題」下載不動產估價師各科試題 PDF，並呼叫 Python(pypdf) 切題寫入 db/seed/questions.moex.json
// 用法：node scripts/fetch-moex.js [起始民國年] [結束民國年] [--code=NNNNNN] [--no-parse]
//   例：node scripts/fetch-moex.js 110 115
// 考選部 URL 規則（114 年實測）：
//   https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?t=Q&code=114130&c=905&s=0306&q=1
//   code = 民國年 + 130（會計師／估價師／專利師聯合考試代碼）、c=905 不動產估價師、s=030X 科目序
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'moex');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const startYear = nums[0] ?? 110;
const endYear = nums[1] ?? nums[0] ?? 115;

const SUBJECTS = [
  ['0301', 'law_civil', '民法物權與不動產法規'],
  ['0302', 'law_land', '土地利用法規'],
  ['0303', 'investment', '不動產投資分析'],
  ['0304', 'practice', '不動產估價實務'],
  ['0305', 'economics', '不動產經濟學'],
  ['0306', 'theory', '不動產估價理論'],
];

async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  if (!r.ok) return `HTTP ${r.status}`;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') return `非 PDF（${(r.headers.get('content-type') || '').split(';')[0]}，${buf.length} bytes）`;
  fs.writeFileSync(dest, buf);
  return null;
}

// 考試代碼末三碼依年度不同（113–115 為 130、112 為 140），逐一嘗試
const CODE_SUFFIXES = ['130', '140', '120', '150', '160', '110', '170', '180'];
async function probeCode(y) {
  for (const suf of CODE_SUFFIXES) {
    const code = `${y}${suf}`;
    const url = `https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?t=Q&code=${code}&c=905&s=0306&q=1`;
    const r = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const head = Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString();
    if (r.ok && head === '%PDF-') return code;
    await new Promise((res) => setTimeout(res, 300));
  }
  return null;
}

const manifest = [];
for (let y = startYear; y <= endYear; y++) {
  const dir = path.join(OUT, String(y));
  fs.mkdirSync(dir, { recursive: true });
  const codeFile = path.join(dir, 'exam-code.txt');
  let code = flags.code || (fs.existsSync(codeFile) ? fs.readFileSync(codeFile, 'utf8').trim() : null);
  if (!code) { code = await probeCode(y); if (code) fs.writeFileSync(codeFile, code); }
  if (!code) { console.log(`${y}: 找不到考試代碼（已試 ${CODE_SUFFIXES.join('/')}），可用 --code= 指定`); continue; }
  console.log(`${y}: 考試代碼 ${code}`);
  for (const [s, subjCode, subjName] of SUBJECTS) {
    const dest = path.join(dir, `${subjCode}.pdf`);
    const url = `https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx?t=Q&code=${code}&c=905&s=${s}&q=1`;
    let status = 'cached';
    if (!fs.existsSync(dest)) {
      status = (await download(url, dest)) || 'ok';
      await new Promise((r) => setTimeout(r, 600));
    }
    console.log(`${y} ${subjName}: ${status}`);
    if (status === 'ok' || status === 'cached') manifest.push({ year: y, subject: subjCode, subject_name: subjName, file: dest, source_url: url });
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`已下載／快取 ${manifest.length} 份試題 → ${OUT}`);

if (!('no-parse' in flags)) {
  const py = process.platform === 'win32' ? 'py' : 'python3';
  // -P 不把腳本目錄加入 sys.path、-E 忽略 PYTHONPATH（PDF 為下載檔，避免載入被植入的模組），但保留使用者 site-packages 以找到 pypdf
  const pyArgs = process.platform === 'win32' ? ['-3', '-P', '-E'] : ['-P', '-E'];
  const r = spawnSync(py, [...pyArgs, path.join(__dirname, 'parse_moex.py'), path.join(OUT, 'manifest.json'), path.join(ROOT, 'db', 'seed', 'questions.moex.json')], { stdio: 'inherit' });
  if (r.status !== 0) console.error('切題失敗：請確認已安裝 Python 3 與 pypdf（py -3 -m pip install pypdf）');
  else console.log('完成。接著執行 npm run init 匯入資料庫。');
}

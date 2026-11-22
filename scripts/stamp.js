// 在 public/index.html 的 JS／CSS 網址後面加上版本號（?v=時間戳），
// 讓每次上線後瀏覽器一定抓新檔，不會沿用快取的舊版。
// 用法：node scripts/stamp.js（npm run build 會自動執行；只改前端程式時可單獨執行）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');
const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const v = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
const html = fs.readFileSync(file, 'utf8');
let n = 0;
const out = html.replace(/((?:href|src)=")(style\.css|config\.js|client-api\.js|grader\.js|app\.js)(?:\?v=\d+)?(")/g, (_, a, name, b) => { n++; return `${a}${name}?v=${v}${b}`; });
if (n !== 5) { console.error(`預期更新 5 個資源連結，實際 ${n} 個；請檢查 public/index.html`); process.exit(1); }
fs.writeFileSync(file, out, 'utf8');
console.log(`index.html 資源版本號 → ${v}`);

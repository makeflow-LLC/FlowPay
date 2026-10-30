// ينسخ ملفات التطبيق (الويب) إلى مجلد واحد نظيف، ويختم رقم الإصدار مكان __BUILD__.
// يستخدمه نشر GitHub Pages وتطبيق أندرويد معًا، فتبقى ملفات الجذر هي المصدر الوحيد.
//   node scripts/build-www.mjs <المجلد>
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = [
  'index.html', 'app.css', 'app.js', 'native.js', 'sw.js', 'manifest.json', 'privacy.html',
  '_headers', '.nojekyll', 'icons', 'img', 'vendor'
];
// الملفات التي تحمل __BUILD__
const STAMPED = ['index.html', 'app.js', 'sw.js'];

if (!process.argv[2]) { console.error('usage: build-www.mjs <dir>'); process.exit(1); }
const out = resolve(process.argv[2]);
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

// رقم الإصدار: رقم البناء في GitHub Actions، وإلا الوقت الحالي (للبناء المحلي)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = process.env.GITHUB_RUN_NUMBER
  ? `${pkg.version}.${process.env.GITHUB_RUN_NUMBER}`
  : `${pkg.version}-${Date.now().toString(36)}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(f, `${out}/${f}`, { recursive: true });
for (const f of STAMPED) {
  const p = `${out}/${f}`;
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__BUILD__', build));
}
console.log(`copied ${FILES.length} entries to ${out}/ (version ${build})`);

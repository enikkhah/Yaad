import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, 'public', 'privacy.html');
const targetPath = path.join(rootDir, 'docs', 'privacy.html');

if (!fs.existsSync(sourcePath)) {
  console.error('[sync-privacy] Missing canonical source file: public/privacy.html');
  process.exit(1);
}

const sourceContent = fs.readFileSync(sourcePath, 'utf8');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

const existingTarget = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
if (existingTarget !== sourceContent) {
  fs.writeFileSync(targetPath, sourceContent, 'utf8');
  console.log('[sync-privacy] Synced docs/privacy.html from public/privacy.html');
} else {
  console.log('[sync-privacy] docs/privacy.html is already in sync with public/privacy.html');
}

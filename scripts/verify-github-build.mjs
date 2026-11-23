import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const rootDir = process.cwd();
const workflowsDir = path.join(rootDir, '.github', 'workflows');

if (!fs.existsSync(workflowsDir)) {
  console.error('[verify-github-build] Missing .github/workflows directory');
  process.exit(1);
}

const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
if (workflowFiles.length === 0) {
  console.error('[verify-github-build] No workflow files found in .github/workflows');
  process.exit(1);
}

function validateBashBlock(file, startLine, bashLines) {
  // Replace GitHub Actions ${{ ... }} expressions with safe placeholder token for bash -n syntax check
  const sanitized = bashLines
    .join('\n')
    .replace(/\$\{\{[^}]*\}\}/g, 'GH_EXPR_VAL') + '\n';
  try {
    execFileSync('bash', ['-n'], {
      input: sanitized,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`[verify-github-build] Bash syntax error (exit code 2) in ${file} (run block starting at line ${startLine}):`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    process.exit(1);
  }
}

for (const file of workflowFiles) {
  const fullPath = path.join(workflowsDir, file);
  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);

  let inRunBlock = false;
  let runIndent = 0;
  let runBlockIndent = 0;
  let runStartLine = 0;
  let bashLines = [];

  let inPythonBlock = false;
  let pythonIndent = 0;
  let pythonLines = [];
  let pythonStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^(\s*)/)[1].length;

    if (inRunBlock) {
      if (trimmed.length > 0 && indent <= runIndent) {
        validateBashBlock(file, runStartLine, bashLines);
        inRunBlock = false;
        bashLines = [];
      } else {
        if (runBlockIndent === 0 && trimmed.length > 0) {
          runBlockIndent = indent;
        }
        const strippedBashLine =
          runBlockIndent > 0 ? line.slice(Math.min(line.length, runBlockIndent)) : line;
        bashLines.push(strippedBashLine);

        // Check embedded python heredocs inside run: |
        if (!inPythonBlock && /python3\s+-\s+<<['"]?PY['"]?/.test(trimmed)) {
          inPythonBlock = true;
          pythonIndent = indent;
          pythonLines = [];
          pythonStartLine = i + 2;
          continue;
        }
        if (inPythonBlock) {
          if (trimmed === 'PY') {
            inPythonBlock = false;
            const pyCode = pythonLines.join('\n') + '\n';
            try {
              execFileSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "<workflow-py>", "exec")'], {
                input: pyCode,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch (err) {
              console.error(
                `[verify-github-build] Python syntax/indentation error in ${file} starting at line ${pythonStartLine}:`
              );
              console.error(err.stderr ? err.stderr.toString() : err.message);
              process.exit(1);
            }
          } else {
            if (trimmed.length > 0 && indent < pythonIndent) {
              console.error(
                `[verify-github-build] Under-indented line inside Python block in ${file}:${i + 1} (indent=${indent}, expected>=${pythonIndent})`
              );
              process.exit(1);
            }
            pythonLines.push(line.slice(Math.min(line.length, pythonIndent)));
          }
        }
        continue;
      }
    }

    if (/^\s*run:\s*\|/.test(line)) {
      inRunBlock = true;
      runIndent = indent;
      runBlockIndent = 0;
      runStartLine = i + 1;
      bashLines = [];
    }
  }

  if (inRunBlock && bashLines.length > 0) {
    validateBashBlock(file, runStartLine, bashLines);
  }
}

// Validate node helper scripts syntax & run Capacitor Android Kotlin patch check
for (const scriptRel of [
  'scripts/generate-transparent-icons.mjs',
  'scripts/setup-bazaar-poolakey.mjs',
  'scripts/setup-myket-billing.mjs',
  'scripts/patch-capacitor-notifications.mjs',
  'scripts/sync-privacy.mjs',
]) {
  const scriptPath = path.join(rootDir, scriptRel);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[verify-github-build] Missing required script: ${scriptRel}`);
    process.exit(1);
  }
  execFileSync('node', ['--check', scriptPath], { stdio: 'inherit' });
}

// Verify strict privacy policy synchronization (matches GitHub Actions pre-lint check)
const publicPrivacyPath = path.join(rootDir, 'public', 'privacy.html');
const docsPrivacyPath = path.join(rootDir, 'docs', 'privacy.html');
if (!fs.existsSync(publicPrivacyPath) || !fs.existsSync(docsPrivacyPath)) {
  console.error('[verify-github-build] Both public/privacy.html and docs/privacy.html must exist.');
  process.exit(1);
}
if (!fs.readFileSync(publicPrivacyPath).equals(fs.readFileSync(docsPrivacyPath))) {
  console.error(
    "[verify-github-build] public/privacy.html and docs/privacy.html are out of sync! Run 'node scripts/sync-privacy.mjs' and persist/commit both files."
  );
  process.exit(1);
}

// Verify package.json and package-lock.json alignment for `npm ci --legacy-peer-deps`
const pkgPath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) {
  console.error('[verify-github-build] Missing package.json or package-lock.json');
  process.exit(1);
}
const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const lockRoot = lockJson.packages && lockJson.packages[''];
if (!lockRoot) {
  console.error('[verify-github-build] Invalid package-lock.json (missing root package entry)');
  process.exit(1);
}
for (const section of ['dependencies', 'devDependencies']) {
  const pkgSection = pkgJson[section] || {};
  const lockSection = lockRoot[section] || {};
  for (const [dep, spec] of Object.entries(pkgSection)) {
    if (lockSection[dep] !== spec) {
      console.error(
        `[verify-github-build] package-lock.json mismatch for ${section}.${dep}: package.json=${spec}, package-lock.json=${lockSection[dep]}`
      );
      process.exit(1);
    }
  }
}

// Verify required CI audio/icon assets exist
const publicDir = path.join(rootDir, 'public');
const wavFiles = fs.existsSync(publicDir) ? fs.readdirSync(publicDir).filter((f) => f.endsWith('.wav')) : [];
if (wavFiles.length === 0) {
  console.error('[verify-github-build] Missing notification .wav files in public/');
  process.exit(1);
}
for (const reqAsset of ['public/logo-transparent.png', 'public/splash.png']) {
  if (!fs.existsSync(path.join(rootDir, reqAsset))) {
    console.error(`[verify-github-build] Missing required CI asset: ${reqAsset}`);
    process.exit(1);
  }
}

execFileSync('node', [path.join(rootDir, 'scripts/patch-capacitor-notifications.mjs')], {
  stdio: 'inherit',
});

console.log(`[verify-github-build] Verified ${workflowFiles.join(', ')} (Bash -n + Python + Kotlin), privacy sync, lockfile parity, assets, and all Android build scripts.`);

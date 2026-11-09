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

for (const file of workflowFiles) {
  const fullPath = path.join(workflowsDir, file);
  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);

  let inRunBlock = false;
  let runIndent = 0;
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
        inRunBlock = false;
      } else {
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
    }
  }
}

// Validate node helper scripts syntax & run Capacitor Android Kotlin patch check
for (const scriptRel of [
  'scripts/generate-transparent-icons.mjs',
  'scripts/setup-bazaar-poolakey.mjs',
  'scripts/patch-capacitor-notifications.mjs',
]) {
  const scriptPath = path.join(rootDir, scriptRel);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[verify-github-build] Missing required script: ${scriptRel}`);
    process.exit(1);
  }
  execFileSync('node', ['--check', scriptPath], { stdio: 'inherit' });
}

execFileSync('node', [path.join(rootDir, 'scripts/patch-capacitor-notifications.mjs')], {
  stdio: 'inherit',
});

console.log(`[verify-github-build] Verified ${workflowFiles.join(', ')} and all Android/Kotlin build scripts.`);

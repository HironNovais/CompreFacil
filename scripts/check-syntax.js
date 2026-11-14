import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
let count = 0;
function check(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'artifacts'].includes(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.js')) { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); count++; }
  }
}
check('.');
console.log(`${count} arquivos JavaScript com sintaxe válida`);

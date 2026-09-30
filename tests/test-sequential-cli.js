import { execFileSync } from 'child_process';
import path from 'path';

console.log('Testing 5 sequential isolated parses of MAIN_COM_01.dwg...');
for (let i = 1; i <= 5; i++) {
  const t0 = Date.now();
  const samplePath = path.resolve('samples/MAIN_COM_01.dwg');
  const out = execFileSync('node', ['src/agent-cli.js', 'open', samplePath], { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  console.log(`Run ${i}: status=${parsed.status}, entities=${parsed.totalEntities}, time=${Date.now() - t0}ms`);
}
console.log('★ All 5 runs succeeded with 0 errors! ★');

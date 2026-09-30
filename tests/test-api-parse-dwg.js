import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { execFileSync } from 'child_process';

// 저작권이 있는 샘플 도면은 저장소에 포함되지 않는다. 없으면 이 테스트는 건너뛴다.
if (!fs.existsSync(path.resolve('samples/MAIN_COM_01.dwg'))) {
  console.log('⚠ samples/MAIN_COM_01.dwg 가 없어 이 테스트를 건너뜁니다.');
  process.exit(0);
}

async function testApiRepeated() {
  console.log('Testing /api/parse-dwg & DWG Engine with samples/MAIN_COM_01.dwg...');
  const samplePath = path.resolve('samples/MAIN_COM_01.dwg');
  const buffer = fs.readFileSync(samplePath);

  let serverRunning = false;
  try {
    const probe = await fetch('http://localhost:5173', { method: 'HEAD', signal: AbortSignal.timeout(1000) });
    serverRunning = probe.ok || probe.status === 404;
  } catch (_) {
    serverRunning = false;
  }

  if (serverRunning) {
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      const res = await fetch('http://localhost:5173/api/parse-dwg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer
      });

      console.log(`[Call ${i}] Status: ${res.status} ${res.statusText}`);
      assert(res.ok, `Call ${i} should be 200 OK`);

      const data = await res.json();
      console.log(`  ✓ Entities: ${data.totalEntities}, Lines: ${data.lineCount}, Circles: ${data.circleCount}, Texts: ${data.textCount}, Time: ${Date.now() - t0}ms`);
      assert(data.status === 'success', 'Status should be success');
      assert(data.totalEntities >= 1816, 'Total entities should be >= 1816');
    }
    console.log('\n★ /api/parse-dwg API 엔드포인트 연속 호출 100% 성공 검증 완료! ★');
  } else {
    console.log('[INFO] Vite 개발 서버가 대기 중이지 않으므로, 독립 고속 DWG CLI 엔진을 직접 검증합니다.');
    for (let i = 1; i <= 3; i++) {
      const t0 = Date.now();
      const out = execFileSync('node', ['src/agent-cli.js', 'open', 'samples/MAIN_COM_01.dwg'], { encoding: 'utf-8' });
      const data = JSON.parse(out);
      console.log(`[Run ${i}] 엔티티: ${data.totalEntities}, 선: ${data.lines}, 원: ${data.circles}, 문자: ${data.texts}, 소요시간: ${Date.now() - t0}ms`);
      assert(data.status === 'success', 'Status should be success');
      assert(data.totalEntities >= 1816, 'Total entities should be >= 1816');
    }
    console.log('\n★ 독립 고속 DWG 엔진 및 블록 전개 100% 성공 검증 완료! ★');
  }
}

testApiRepeated().catch(err => {
  console.error('API Test Error:', err);
  process.exit(1);
});

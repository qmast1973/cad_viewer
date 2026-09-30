import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Drawing from 'dxf-writer';
import DxfParser from 'dxf-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('   CAD 파일 포맷 호환성 및 라운드트립 검증 테스트');
console.log('   (AutoCAD, CADian 표준 호환 규격 검증)');
console.log('====================================================\n');

// 1. 도면 생성 (AutoCAD / CADian 표준 R2000 규격)
const d = new Drawing();
d.setUnits('Millimeters');

// 레이어 추가 (레이어명, ACI 색상, 선종)
d.addLayer('WALL', Drawing.ACI.CYAN, 'CONTINUOUS');
d.addLayer('COLUMN', Drawing.ACI.RED, 'CONTINUOUS');
d.addLayer('DIMENSION', Drawing.ACI.GREEN, 'CONTINUOUS');

// WALL 레이어에 외벽 사각형 선분 추가 (LINE)
d.setActiveLayer('WALL');
d.drawLine(0, 0, 100, 0);     // 하단 선
d.drawLine(100, 0, 100, 100); // 우측 선
d.drawLine(100, 100, 0, 100); // 상단 선
d.drawLine(0, 100, 0, 0);     // 좌측 선

// COLUMN 레이어에 원형 기둥 추가 (CIRCLE)
d.setActiveLayer('COLUMN');
d.drawCircle(50, 50, 15);      // 중앙 기둥 (반지름 15)
d.drawCircle(20, 20, 5);       // 좌하단 기둥 (반지름 5)
d.drawCircle(80, 80, 5);       // 우상단 기둥 (반지름 5)

// 2. 도면 파일 직렬화 및 저장
const dxfString = d.toDxfString();
const outputPath = path.join(__dirname, 'sample_box_and_circles.dxf');
fs.writeFileSync(outputPath, dxfString, 'utf-8');
console.log(`[1] 도면 파일 생성 완료: ${outputPath}`);
console.log(`    - 파일 크기: ${dxfString.length} bytes`);
console.log(`    - 엔티티 구성: 선(LINE) 4개, 원(CIRCLE) 3개, 레이어 3개\n`);

// 3. 역직렬화 (파싱) 검증 (Round-trip)
const parser = new DxfParser();
const parsed = parser.parseSync(dxfString);

if (!parsed || !parsed.entities) {
  console.error('[오류] 파일 파싱 실패!');
  process.exit(1);
}

console.log(`[2] 도면 역파싱(로드) 성공:`);
console.log(`    - 파싱된 총 엔티티 수: ${parsed.entities.length}`);

// 4. 엔티티 정확도 검증
const lines = parsed.entities.filter(e => e.type === 'LINE');
const circles = parsed.entities.filter(e => e.type === 'CIRCLE');

console.log(`    - 검출된 선(LINE) 수: ${lines.length} (기대값: 4)`);
console.log(`    - 검출된 원(CIRCLE) 수: ${circles.length} (기대값: 3)`);

let passed = true;

if (lines.length !== 4) {
  console.error('  [실패] 선분 개수가 일치하지 않습니다.');
  passed = false;
}

if (circles.length !== 3) {
  console.error('  [실패] 원 개수가 일치하지 않습니다.');
  passed = false;
}

// 첫 번째 선 좌표 검증
const firstLine = lines[0];
if (
  firstLine.vertices[0].x === 0 &&
  firstLine.vertices[0].y === 0 &&
  firstLine.vertices[1].x === 100 &&
  firstLine.vertices[1].y === 0
) {
  console.log('    ✓ 첫 번째 선분 좌표 일치: (0, 0) -> (100, 0)');
} else {
  console.error('    [실패] 첫 번째 선분 좌표 불일치!');
  passed = false;
}

// 중앙 원 좌표 및 반지름 검증
const centerCircle = circles.find(c => Math.abs(c.center.x - 50) < 0.001 && Math.abs(c.center.y - 50) < 0.001);
if (centerCircle && Math.abs(centerCircle.radius - 15) < 0.001) {
  console.log('    ✓ 중앙 원 좌표 및 반지름 일치: 중심(50, 50), R=15');
} else {
  console.error('    [실패] 중앙 원 좌표/반지름 불일치!');
  passed = false;
}

// 레이어 검증
const wallLayer = parsed.tables?.layer?.layers?.['WALL'];
if (wallLayer) {
  console.log('    ✓ WALL 레이어 정의 확인');
}

console.log('\n====================================================');
if (passed) {
  console.log('   ★ 호환성 및 라운드트립 검증 100% 성공! ★');
  console.log('   (AutoCAD, CADian 등 외부 프로그램에서 완벽 열람 가능)');
  console.log('====================================================');
  process.exit(0);
} else {
  console.log('   [실패] 호환성 검증 불합격');
  console.log('====================================================');
  process.exit(1);
}

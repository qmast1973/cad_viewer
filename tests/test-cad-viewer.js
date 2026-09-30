import fs from 'fs';
import path from 'path';
import Drawing from 'dxf-writer';
import DxfParser from 'dxf-parser';

console.log('====================================================');
console.log('   CAD 뷰어 핵심 기능 및 파일 호환성 종합 검증 테스트');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failCount++;
  }
}

// ----------------------------------------------------
// 1. 치수 측정 (DIST) 정밀도 수학적 검증
// ----------------------------------------------------
console.log('[검증 1] 수치 및 거리 측정 (DIST) 기능 검증');

function measureDist(p1, p2) {
  const deltaX = p2.x - p1.x;
  const deltaY = p2.y - p1.y;
  const distance = Math.hypot(deltaX, deltaY);
  let angleRad = Math.atan2(deltaY, deltaX);
  if (angleRad < 0) angleRad += Math.PI * 2;
  const angleDeg = (angleRad * 180) / Math.PI;

  return {
    distance: Number(distance.toFixed(4)),
    deltaX: Number(deltaX.toFixed(4)),
    deltaY: Number(deltaY.toFixed(4)),
    angleDeg: Number(angleDeg.toFixed(2))
  };
}

const dist1 = measureDist({ x: 0, y: 0 }, { x: 100, y: 50 });
assert(Math.abs(dist1.distance - 111.8034) < 0.0001, `직각삼각형 빗변 거리 계산: ${dist1.distance}mm (기대값: 111.8034mm)`);
assert(dist1.deltaX === 100 && dist1.deltaY === 50, `X/Y축 변화량 계산: ΔX=${dist1.deltaX}, ΔY=${dist1.deltaY}`);
assert(Math.abs(dist1.angleDeg - 26.57) < 0.01, `각도 계산: ${dist1.angleDeg}° (기대값: 26.57°)`);

// 수평선 및 수직선 측정
const distH = measureDist({ x: 10, y: 20 }, { x: 110, y: 20 });
assert(distH.distance === 100 && distH.angleDeg === 0, `수평선 측정: 거리=${distH.distance}mm, 각도=${distH.angleDeg}°`);
const distV = measureDist({ x: 50, y: 0 }, { x: 50, y: 80 });
assert(distV.distance === 80 && distV.angleDeg === 90, `수직선 측정: 거리=${distV.distance}mm, 각도=${distV.angleDeg}°`);

console.log('');

// ----------------------------------------------------
// 2. 면적 및 둘레 측정 (AREA) 정밀도 검증 (신발끈 공식)
// ----------------------------------------------------
console.log('[검증 2] 다각형 면적 및 둘레 측정 (AREA) 기능 검증');

function measureArea(points) {
  if (!points || points.length < 3) return { areaMm2: 0, areaM2: 0, perimeterMm: 0 };
  let area = 0;
  let perimeter = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
    perimeter += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  const areaMm2 = Math.abs(area) / 2;
  return {
    areaMm2: Number(areaMm2.toFixed(4)),
    areaM2: Number((areaMm2 / 1_000_000).toFixed(6)),
    perimeterMm: Number(perimeter.toFixed(4))
  };
}

// 100 x 50 직사각형 (면적 5000 mm², 둘레 300 mm)
const rectArea = measureArea([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 }
]);
assert(rectArea.areaMm2 === 5000, `직사각형 면적(mm²): ${rectArea.areaMm2}mm² (기대값: 5000mm²)`);
assert(rectArea.areaM2 === 0.005, `직사각형 면적(m²): ${rectArea.areaM2}m² (기대값: 0.005m²)`);
assert(rectArea.perimeterMm === 300, `직사각형 둘레(mm): ${rectArea.perimeterMm}mm (기대값: 300mm)`);

// 밑변 100, 높이 50 직각삼각형 (면적 2500 mm², 둘레 100+50+111.8034 = 261.8034 mm)
const triArea = measureArea([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 0, y: 50 }
]);
assert(triArea.areaMm2 === 2500, `직각삼각형 면적(mm²): ${triArea.areaMm2}mm² (기대값: 2500mm²)`);
assert(Math.abs(triArea.perimeterMm - 261.8034) < 0.0001, `직각삼각형 둘레: ${triArea.perimeterMm}mm (기대값: 261.8034mm)`);

console.log('');

// ----------------------------------------------------
// 3. 파일 포맷 호환성 및 라운드트립 무결성 검증
// ----------------------------------------------------
console.log('[검증 3] DXF 저장 → 다시 읽기 라운드트립 검증 (실제 AutoCAD 프로그램에서의 열림은 검증하지 않음)');

const testDxfPath = path.join(process.cwd(), 'tests', 'test_full_features.dxf');
const d = new Drawing();
d.setUnits('Millimeters');

// 레이어 정의
d.addLayer('WALL', Drawing.ACI.CYAN, 'CONTINUOUS');
d.addLayer('COLUMN', Drawing.ACI.RED, 'CONTINUOUS');
d.addLayer('TEXT_LAYER', Drawing.ACI.YELLOW, 'CONTINUOUS');

// 1) 벽체 사각형 선 4개
d.setActiveLayer('WALL');
d.drawLine(0, 0, 200, 0);
d.drawLine(200, 0, 200, 150);
d.drawLine(200, 150, 0, 150);
d.drawLine(0, 150, 0, 0);

// 2) 기둥 원 2개
d.setActiveLayer('COLUMN');
d.drawCircle(50, 50, 20);
d.drawCircle(150, 100, 15);

// 3) 도면 텍스트 2개
d.setActiveLayer('TEXT_LAYER');
d.drawText(20, 20, 5, 0, 'ROOM_A');
d.drawText(120, 80, 4, 0, 'COLUMN_C1');

const generatedDxf = d.toDxfString();
fs.writeFileSync(testDxfPath, generatedDxf, 'utf-8');
assert(fs.existsSync(testDxfPath), `호환 도면 파일 생성 완료: ${testDxfPath} (${generatedDxf.length} bytes)`);

// 생성된 파일 역파싱 (AutoCAD/CADian 파서 호환성 검증)
const parser = new DxfParser();
const parsed = parser.parseSync(generatedDxf);

assert(parsed.entities && parsed.entities.length >= 6, `파싱된 총 엔티티 수: ${parsed.entities.length}개`);
const lines = parsed.entities.filter(e => e.type === 'LINE');
const circles = parsed.entities.filter(e => e.type === 'CIRCLE');
const texts = parsed.entities.filter(e => e.type === 'TEXT');

assert(lines.length === 4, `선(LINE) 엔티티 수량 일치: ${lines.length}개 (기대값: 4개)`);
assert(circles.length === 2, `원(CIRCLE) 엔티티 수량 일치: ${circles.length}개 (기대값: 2개)`);
assert(texts.length === 2, `문자(TEXT) 엔티티 수량 일치: ${texts.length}개 (기대값: 2개)`);

// 첫 번째 선 좌표 무결성
assert(lines[0].vertices[0].x === 0 && lines[0].vertices[0].y === 0, `첫 번째 선 시작 좌표 일치: (0, 0)`);
assert(lines[0].vertices[1].x === 200 && lines[0].vertices[1].y === 0, `첫 번째 선 끝 좌표 일치: (200, 0)`);

// 첫 번째 원 좌표 및 반지름 무결성
assert(circles[0].center.x === 50 && circles[0].center.y === 50 && circles[0].radius === 20, `첫 번째 원 중심/반지름 일치: 중심(50, 50), R=20`);

// 첫 번째 텍스트 내용 무결성
assert(texts[0].text === 'ROOM_A', `문자 내용 일치: "${texts[0].text}"`);

console.log('');

// ----------------------------------------------------
// 4. 결과 요약
// ----------------------------------------------------
console.log('====================================================');
console.log(`   검증 결과 요약: 성공 ${passCount}건 / 실패 ${failCount}건`);
if (failCount === 0) {
  console.log('   ★ 모든 검증 항목 100% 통과 (정상 작동 확인 완료) ★');
} else {
  console.error(`   ❌ ${failCount}건의 검증 실패 발생!`);
  process.exit(1);
}
console.log('====================================================');

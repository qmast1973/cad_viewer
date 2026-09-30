// 서버 파서의 DXF 해석(parseDxfText) 검증 - 합성 DXF 사용 (외부 도면 파일이 필요 없음)
// POINT / SOLID / SPLINE / DIMENSION(블록 펼침) / 문자 정렬·이스케이프 / 색 해석 / 표시하지 못한 개체 기록
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { parseDxfText } = await import(pathToFileURL(path.resolve('src/core/dwg-parser-isolated.ts')).href);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ [PASS] ${name} ${detail}`); }
  else { fail++; console.log(`  ✗ [FAIL] ${name} ${detail}`); }
};

const g = (code, val) => `${code}\r\n${val}\r\n`;
const block =
  g(0, 'SECTION') + g(2, 'BLOCKS') +
  g(0, 'BLOCK') + g(5, '20') + g(330, '2') + g(100, 'AcDbEntity') + g(8, '0') + g(100, 'AcDbBlockBegin') +
  g(2, '*D1') + g(70, 0) + g(10, 0) + g(20, 0) + g(30, 0) + g(3, '*D1') + g(1, '') +
  g(0, 'LINE') + g(5, '22') + g(330, '20') + g(100, 'AcDbEntity') + g(8, '0') + g(100, 'AcDbLine') +
  g(10, 10) + g(20, 10) + g(30, 0) + g(11, 50) + g(21, 10) + g(31, 0) +
  g(0, 'ENDBLK') + g(5, '21') + g(330, '20') + g(100, 'AcDbEntity') + g(8, '0') + g(100, 'AcDbBlockEnd') +
  g(0, 'ENDSEC');

const entities =
  g(0, 'POINT') + g(8, '0') + g(10, 5) + g(20, 6) + g(30, 0) +
  g(0, 'SOLID') + g(8, '0') + g(10, 0) + g(20, 0) + g(30, 0) + g(11, 10) + g(21, 0) + g(31, 0) +
    g(12, 0) + g(22, 10) + g(32, 0) + g(13, 10) + g(23, 10) + g(33, 0) +
  g(0, 'SPLINE') + g(8, '0') + g(70, 8) + g(71, 3) + g(72, 8) + g(73, 4) + g(74, 0) +
    [0, 0, 0, 0, 1, 1, 1, 1].map(k => g(40, k)).join('') +
    [[0, 0], [10, 20], [20, 20], [30, 0]].map(([x, y]) => g(10, x) + g(20, y) + g(30, 0)).join('') +
  g(0, 'DIMENSION') + g(8, '0') + g(2, '*D1') + g(10, 30) + g(20, 10) + g(30, 0) + g(70, 0) +
  g(0, 'TEXT') + g(8, '0') + g(10, 50) + g(20, 50) + g(30, 0) + g(40, 3) + g(1, 'HI \\U+BCF8 90%%d') +
    g(72, 1) + g(11, 50) + g(21, 50) + g(31, 0) + g(73, 0) +
  g(0, 'MTEXT') + g(8, '0') + g(10, 20) + g(20, 20) + g(30, 0) + g(40, 2) + g(41, 30) + g(71, 5) + g(1, 'MULTI') +
  g(0, 'LINE') + g(8, '0') + g(62, 1) + g(10, 0) + g(20, 0) + g(30, 0) + g(11, 1) + g(21, 1) + g(31, 0) +
  g(0, 'LINE') + g(8, '0') + g(10, 0) + g(20, 0) + g(30, 0) + g(11, 2) + g(21, 2) + g(31, 0) +
  g(0, 'LEADER') + g(8, '0');

const dxf = block + g(0, 'SECTION') + g(2, 'ENTITIES') + entities + g(0, 'ENDSEC') + g(0, 'EOF');

console.log('====================================================');
console.log('   parseDxfText 검증 (합성 DXF)');
console.log('====================================================');

const r = parseDxfText(dxf);
check('해석 성공', r && r.status === 'success');
const by = {};
for (const e of r.entities) by[e.type] = (by[e.type] || 0) + 1;

console.log('[검증 1] 새로 지원하는 개체');
const pt = r.entities.find(e => e.type === 'POINT');
check('POINT: 위치 (5,6)', pt && pt.position.x === 5 && pt.position.y === 6);

const solid = r.entities.find(e => e.type === 'HATCH');
const sp = solid ? solid.loops[0] : [];
check('SOLID: 채움 사각형으로 변환 (꼭짓점 순서 1,2,4,3 보정)', solid && solid.solid && sp.length === 4 &&
  sp[0].x === 0 && sp[0].y === 0 && sp[1].x === 10 && sp[1].y === 0 && sp[2].x === 10 && sp[2].y === 10 && sp[3].x === 0 && sp[3].y === 10,
  `(꼭짓점: ${JSON.stringify(sp)})`);

const lines = r.entities.filter(e => e.type === 'LINE');
const splineLines = lines.filter(l => l.start.y > 0.5 || l.end.y > 0.5);
check('SPLINE: 곡선을 선분 여러 개로 변환', splineLines.length >= 30, `(곡선에서 나온 선분 ${splineLines.length}개)`);
const xs = lines.flatMap(l => [l.start.x, l.end.x]);
check('SPLINE: 끝점이 제어점 양 끝(0, 30)에 도달', Math.min(...xs) <= 0.001 && xs.some(x => Math.abs(x - 30) < 0.001));

const dimLine = lines.find(l => Math.abs(l.start.x - 10) < 1e-6 && Math.abs(l.start.y - 10) < 1e-6 && Math.abs(l.end.x - 50) < 1e-6);
check('DIMENSION: 치수 블록(*D1)의 선이 펼쳐져 표시됨', !!dimLine);

console.log('[검증 2] 문자 해석');
const texts = r.entities.filter(e => e.type === 'TEXT');
const hi = texts.find(t => t.text.startsWith('HI'));
check('TEXT: \\U+ 이스케이프와 %%d 기호 해석', hi && hi.text === 'HI 본 90°', `(실제: ${hi && hi.text})`);
check('TEXT: 가운데 정렬(halign=1) 기준점', hi && hi.anchor && hi.anchor.x === 0.5 && hi.anchor.y === 0, `(anchor: ${JSON.stringify(hi && hi.anchor)})`);
const mt = texts.find(t => t.text === 'MULTI');
check('MTEXT: 기준점 5(가운데/중간)', mt && mt.anchor && mt.anchor.x === 0.5 && mt.anchor.y === 0.5, `(anchor: ${JSON.stringify(mt && mt.anchor)})`);

console.log('[검증 3] 색 해석');
const red = lines.find(l => l.end.x === 1 && l.end.y === 1);
check('개체 색 ACI 1 = 빨강', red && red.color === '#FF0000', `(실제: ${red && red.color})`);
const plain = lines.find(l => l.end.x === 2 && l.end.y === 2);
check('색 미지정(ByLayer) 개체는 레이어 색(흰색)', plain && plain.color === '#FFFFFF', `(실제: ${plain && plain.color})`);

console.log('[검증 4] 표시하지 못한 개체 기록');
check('처리하지 못한 종류(LEADER)가 skippedEntities에 기록됨', r.skippedEntities && r.skippedEntities.LEADER === 1, `(실제: ${JSON.stringify(r.skippedEntities)})`);
check('처리하는 종류는 skippedEntities에 없음', r.skippedEntities && !r.skippedEntities.LINE && !r.skippedEntities.POINT && !r.skippedEntities.SPLINE);

console.log('====================================================');
console.log(`   검증 결과 요약: 성공 ${pass}건 / 실패 ${fail}건`);
if (fail > 0) {
  console.log('   ✗ 일부 검증 실패');
  process.exit(1);
}
console.log('   ★ parseDxfText 검증 100% 통과 ★');
console.log('====================================================');

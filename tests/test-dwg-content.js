// 서버 파서(src/core/dwg-parser-isolated.ts) 내용 충실도 검증
// - HATCH 채움, ELLIPSE, MTEXT 기준점(anchor), ACI 256색 표, ATTDEF 태그 비표시, 도면 전체 Extents
// 실행: node tests/test-dwg-content.js (프로젝트 루트에서 실행 - bin/dwg2dxf.exe 경로 기준)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 저작권이 있는 샘플 도면은 저장소에 포함되지 않는다. 없으면 이 테스트는 건너뛴다.
if (!fs.existsSync(path.resolve('samples/MAIN_COM_01.dwg'))) {
  console.log('⚠ samples/MAIN_COM_01.dwg 가 없어 이 테스트를 건너뜁니다.');
  process.exit(0);
}

const mod = await import(pathToFileURL(path.resolve('src/core/dwg-parser-isolated.ts')).href);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ [PASS] ${name} ${detail}`); }
  else { fail++; console.log(`  ✗ [FAIL] ${name} ${detail}`); }
};

console.log('====================================================');
console.log('   서버 파서 내용 충실도 검증 (MAIN_COM_01.dwg)');
console.log('====================================================');

console.log('[검증 1] ACI 256색 표');
check('ACI 1 = 빨강', mod.aciToHex(1) === '#FF0000');
check('ACI 7 = 흰색', mod.aciToHex(7) === '#FFFFFF');
check('ACI 10 = #FF0000', mod.aciToHex(10) === '#FF0000');
check('ACI 11 = #FF7F7F', mod.aciToHex(11) === '#FF7F7F');
check('ACI 12 = #A50000', mod.aciToHex(12) === '#A50000');
check('ACI 160 = #003FFF', mod.aciToHex(160) === '#003FFF', `(실제: ${mod.aciToHex(160)})`);
check('ACI 8 = #808080, 9 = #C0C0C0, 255 = #FFFFFF', mod.aciToHex(8) === '#808080' && mod.aciToHex(9) === '#C0C0C0' && mod.aciToHex(255) === '#FFFFFF');
check('범위 밖(0, 256)은 null', mod.aciToHex(0) === null && mod.aciToHex(256) === null);

console.log('[검증 2] DWG 전체 내용 파싱');
const r = mod.parseDwgIsolated(fs.readFileSync('samples/MAIN_COM_01.dwg'));
const by = {};
for (const e of r.entities) by[e.type] = (by[e.type] || 0) + 1;
check('파싱 성공', r.status === 'success');
check('HATCH 125개 적재 (점/단자/로고 채움)', by.HATCH === 125, `(실제: ${by.HATCH})`);
check('원(CIRCLE) 363개', by.CIRCLE === 363, `(실제: ${by.CIRCLE})`);
check('선분(LINE) 1050개 (ELLIPSE·ARC·폴리라인 호 포함)', by.LINE === 1050, `(실제: ${by.LINE})`);
check('문자(TEXT) 603개', by.TEXT === 603, `(실제: ${by.TEXT})`);

console.log('[검증 3] 도면 전체 Extents (표제란 포함)');
const bb = r.boundingBox || {};
check('도면 가로 417.761 ± 0.01', Math.abs(bb.width - 417.761) < 0.01, `(실제: ${bb.width})`);
check('도면 세로 286.195 ± 0.01', Math.abs(bb.height - 286.195) < 0.01, `(실제: ${bb.height})`);

console.log('[검증 4] 문자 처리');
const texts = r.entities.filter(e => e.type === 'TEXT');
check('MTEXT 기준점(anchor) 500개 이상 반영', texts.filter(t => t.anchor).length >= 500);
check('가운데(0.5, 0.5) 기준 문자 존재', texts.some(t => t.anchor && t.anchor.x === 0.5 && t.anchor.y === 0.5));
check('오른쪽(1, 0.5) 기준 문자 존재', texts.some(t => t.anchor && t.anchor.x === 1 && t.anchor.y === 0.5));
check('ATTDEF 태그 문자(PRJ_NO, R_CHK) 비표시', !texts.some(t => t.text === 'PRJ_NO' || t.text === 'R_CHK'));
check('MTEXT 서식 코드 잔존 0건', !texts.some(t => /\\[fFHWCQAT][^;]*;/.test(t.text)));

console.log('[검증 5] HATCH 데이터 무결성');
const hatches = r.entities.filter(e => e.type === 'HATCH');
const allPts = hatches.flatMap(h => h.loops.flat());
check('모든 HATCH 루프가 3점 이상', hatches.every(h => h.loops.every(l => l.length >= 3)));
check('좌표에 NaN/Infinity 없음', allPts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
check('SOLID 채움 125개', hatches.filter(h => h.solid).length === 125);
const holed = hatches.filter(h => h.loops.length === 2);
check('구멍 있는 HATCH(R 글자) 1개', holed.length === 1);

console.log('[검증 6] 모델 적재 → HATCH 이동/복사 → DXF 내보내기 라운드트립');
const { CadModel, cleanCadMText } = await import(pathToFileURL(path.resolve('src/core/cad-model.ts')).href);
check('문자 해석: \\U+XXXX 유니코드 이스케이프', cleanCadMText('\\U+BCF8\\U+B3C4 A') === '본도 A', `(실제: ${cleanCadMText('\\U+BCF8\\U+B3C4 A')})`);
check('문자 해석: %%d %%p %%c 특수 기호', cleanCadMText('90%%d %%p5 %%c20') === '90° ±5 Ø20', `(실제: ${cleanCadMText('90%%d %%p5 %%c20')})`);
const { DxfParser } = await import('dxf-json');
const model = new CadModel();
const loaded = model.loadParsedEntities(r);
check('모델에 HATCH 125개 적재', loaded.hatchCount === 125, `(실제: ${loaded.hatchCount})`);
check('파일 레이어만 등록 (샘플 레이어 WALL 없음)', !model.getLayers().some(l => l.name === 'WALL') && model.getLayers().some(l => l.name === 'LAYER_1'));
check('텍스트 기준점(anchor) 모델에 유지', model.getEntities().filter(e => e.type === 'TEXT' && e.anchor).length >= 500);

const h0 = model.getEntities().find(e => e.type === 'HATCH');
const p0 = { ...h0.loops[0][0] };
model.selectEntity(h0.id);
model.moveSelected(10, 5);
const p1 = h0.loops[0][0];
check('HATCH 이동 (Δ=10,5)', Math.abs(p1.x - p0.x - 10) < 1e-9 && Math.abs(p1.y - p0.y - 5) < 1e-9);

model.copy();
const pasted = model.paste(1, 2);
const hp = model.getEntity(pasted[0]);
check('HATCH 복사·붙여넣기 (개수 +1, 오프셋 1,2)', model.getEntities().filter(e => e.type === 'HATCH').length === 126 && Math.abs(hp.loops[0][0].x - p1.x - 1) < 1e-9 && Math.abs(hp.loops[0][0].y - p1.y - 2) < 1e-9);
check('붙여넣기가 원본 HATCH를 변경하지 않음', h0.loops[0][0].x === p1.x);

const dxfOut = model.exportDxf();
const outDoc = new DxfParser().parseSync(dxfOut);
const outBy = {};
for (const e of outDoc.entities) outBy[e.type] = (outBy[e.type] || 0) + 1;
const polyCount = (outBy.LWPOLYLINE || 0) + (outBy.POLYLINE || 0);
// 기대값: 모델 안 모든 HATCH의 경계 루프 수 합 (구멍 있는 글자는 루프가 2개)
const expectedLoops = model.getEntities().filter(e => e.type === 'HATCH').reduce((n, h) => n + h.loops.length, 0);
check('DXF 저장: HATCH 경계가 닫힌 폴리라인으로 저장', polyCount === expectedLoops && expectedLoops > 125, `(폴리라인 ${polyCount} / 경계 루프 ${expectedLoops})`);
check('DXF 저장: 문자 603개 유지', (outBy.TEXT || 0) === 603, `(실제: ${outBy.TEXT})`);
const aligned = outDoc.entities.filter(e => e.type === 'TEXT' && (e.halign || e.valign)).length;
check('DXF 저장: 문자 정렬(기준점) 저장', aligned >= 500, `(정렬 지정 문자 ${aligned}개)`);

// 저장 후 색: 뷰어에서 전부 흰색이던 개체가 저장 후 레이어 색(빨강/초록 등)으로 바뀌지 않아야 한다
const layerAciOut = {};
for (const l of (outDoc.tables.LAYER?.entries || [])) layerAciOut[l.name] = l.colorIndex;
const notWhite = [];
for (const e of outDoc.entities) {
  const isWhite = (e.color !== undefined && e.color !== null)
    ? (e.color >>> 0) === 0xFFFFFF
    : (layerAciOut[e.layer] === 7);
  if (!isWhite) notWhite.push(`${e.type}@${e.layer}`);
}
// 저장한 DXF를 다시 불러왔을 때 도면이 같은지 (저장 → 불러오기 왕복)
const reloaded = new CadModel();
reloaded.loadFromDxf(dxfOut);
const cnt = m => { const c = {}; for (const e of m.getEntities()) c[e.type] = (c[e.type] || 0) + 1; return c; };
const cr = cnt(reloaded);
check('왕복: 선/원/문자 개수 유지', cr.LINE === outBy.LINE && cr.CIRCLE === outBy.CIRCLE && cr.TEXT === outBy.TEXT, `(다시 불러옴: ${JSON.stringify(cr)})`);
const bbAfter = reloaded.getBoundingBox();
const bbBefore = model.getBoundingBox();
check('왕복: 도면 범위(Extents) 유지', Math.abs(bbAfter.width - bbBefore.width) < 0.5 && Math.abs(bbAfter.height - bbBefore.height) < 0.5, `(폭 ${bbAfter.width.toFixed(2)} / ${bbBefore.width.toFixed(2)})`);
const anchoredAfter = reloaded.getEntities().filter(e => e.type === 'TEXT' && e.anchor).length;
check('왕복: 문자 기준점(정렬) 복원', anchoredAfter >= 500, `(복원된 정렬 문자 ${anchoredAfter}개)`);

check('DXF 저장: 모든 개체가 뷰어와 같은 흰색으로 해석됨', notWhite.length === 0, `(흰색이 아닌 개체 ${notWhite.length}개 ${notWhite.slice(0, 3).join(',')})`);
check('DXF 저장: 색이 있는 레이어의 개체는 트루컬러(흰색)를 직접 가짐', outDoc.entities.filter(e => e.color !== undefined && e.color !== null).length > 0);

console.log('====================================================');
console.log(`   검증 결과 요약: 성공 ${pass}건 / 실패 ${fail}건`);
if (fail > 0) {
  console.log('   ✗ 일부 검증 실패');
  process.exit(1);
}
console.log('   ★ 서버 파서 내용 충실도 검증 100% 통과 ★');
console.log('====================================================');

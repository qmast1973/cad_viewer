// 가벼운 도면(.cadlite) 검증 - 합성 데이터 사용 (외부 도면 파일이 필요 없음)
// 저장 → 압축 → 해제 → 읽기를 거쳐도 개체·선분·레이어·도면 범위가 그대로인지 확인한다.
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const { CadModel } = await import(pathToFileURL(path.resolve('src/core/cad-model.ts')).href);
const { encodeLite, decodeLite, isGzip } = await import(pathToFileURL(path.resolve('src/core/cadlite.ts')).href);
const { parseDxfText } = await import(pathToFileURL(path.resolve('src/core/dwg-parser-isolated.ts')).href);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ [PASS] ${name} ${detail}`); }
  else { fail++; console.log(`  ✗ [FAIL] ${name} ${detail}`); }
};

console.log('====================================================');
console.log('   가벼운 도면(.cadlite) 검증');
console.log('====================================================');

// 파일로 저장했다가 다시 읽는 과정을 그대로 흉내 낸다 (gzip 압축 → 해제 → 4바이트 경계 버퍼)
function roundTrip(model, source) {
  const snap = model.getLiteSnapshot(source);
  const parts = encodeLite(snap.header, snap.batches);
  const gz = zlib.gzipSync(Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength))));
  const raw = zlib.gunzipSync(gz);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return { gz, dec: decodeLite(ab) };
}

// 1) 일반 도면: 선·원·호·폴리라인·문자·해치·점
const a = new CadModel();
a.resetLayers();
a.addLayer('WALL', '#00FFFF');
a.addLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 'WALL', '#00FFFF');
a.addCircle({ x: 50, y: 50 }, 15, 'WALL', '#FF5555');
a.addArc({ x: 10, y: 10 }, 5, 0, Math.PI, 'WALL', '#FFFFFF');
a.addPolyline([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], true, 'WALL', '#FFFFFF');
a.addText('한글 문자 ABC', { x: 20, y: 30 }, 4, 15, 'WALL', '#FFE873', { x: 0.5, y: 0.5 });
a.addHatch([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]], true, 'WALL', '#FF0000');
a.addPoint({ x: 7, y: 7 }, 'WALL', '#58A6FF');
const rtA = roundTrip(a, 'sample.dwg');
check('압축 파일은 gzip', isGzip(new Uint8Array(rtA.gz)));
const b = new CadModel();
b.loadLite(rtA.dec);
check('일반 도면: 개체 수 유지', b.getEntities().length === a.getEntities().length, `(${b.getEntities().length}/${a.getEntities().length})`);
const types = m => m.getEntities().map(e => e.type).sort().join(',');
check('일반 도면: 개체 종류 유지', types(a) === types(b), types(b));
const tx = b.getEntities().find(e => e.type === 'TEXT');
check('문자 내용·회전·기준점 유지', tx && tx.text === '한글 문자 ABC' && tx.rotation === 15 && tx.anchor && tx.anchor.x === 0.5);
check('레이어와 색 유지', b.getLayers().some(l => l.name === 'WALL' && l.color.toUpperCase() === '#00FFFF'));
const ba = a.getBoundingBox(); const bb = b.getBoundingBox();
check('도면 범위 유지', ba && bb && Math.abs(ba.width - bb.width) < 1e-6 && Math.abs(ba.height - bb.height) < 1e-6);
check('원본 파일 이름 기록', rtA.dec.header.source === 'sample.dwg');

// 2) 대용량 모드: 합성 DXF로 선분 묶음(lineBatches)을 만들고 왕복
const g = (code, val) => `${code}\r\n${val}\r\n`;
let ents = '';
for (let i = 0; i < 400; i++) {
  ents += g(0, 'LINE') + g(8, i % 2 ? 'A' : 'B') + g(10, i) + g(20, 0) + g(30, 0) + g(11, i) + g(21, 10) + g(31, 0);
}
ents += g(0, 'TEXT') + g(8, 'A') + g(10, 3) + g(20, 4) + g(30, 0) + g(40, 2.5) + g(1, 'HELLO');
const dxf = g(0, 'SECTION') + g(2, 'ENTITIES') + ents + g(0, 'ENDSEC') + g(0, 'EOF');
const parsed = parseDxfText(dxf, { compactLines: true });
check('대용량 모드: 선분이 묶음으로 전달됨', parsed && parsed.lineBatches && parsed.lineBatches.length === 2 && parsed.entities.every(e => e.type !== 'LINE'));
const batches = parsed.lineBatches.map(bt => {
  const raw = Buffer.from(bt.data, 'base64');
  return { layer: bt.layer, color: bt.color, count: bt.count, positions: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) };
});
const snapHeader = { version: 1, layers: parsed.layers, layerColors: parsed.layerColors, entities: parsed.entities, lineOrigin: parsed.lineOrigin };
const parts = encodeLite(snapHeader, batches);
const raw2 = zlib.gunzipSync(zlib.gzipSync(Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength)))));
const dec2 = decodeLite(raw2.buffer.slice(raw2.byteOffset, raw2.byteOffset + raw2.byteLength));
const c = new CadModel();
const res = c.loadLite(dec2);
check('대용량 도면: 선분 400개 유지', c.getStaticLineCount() === 400 && res.lineCount === 400, `(${c.getStaticLineCount()})`);
check('대용량 도면: 문자 개체 유지', c.getEntities().filter(e => e.type === 'TEXT').length === 1);
const bc = c.getBoundingBox();
check('대용량 도면: 범위 계산', bc && Math.abs(bc.width - 399) < 0.01 && Math.abs(bc.height - 10) < 0.01, bc ? `(${bc.width} x ${bc.height})` : '');

// 3) 대용량 모드 → 다시 저장(.cadlite) → 읽기: 선분 묶음이 그대로 이어지는지
const rtC = roundTrip(c, 'big.dwg');
const d = new CadModel();
d.loadLite(rtC.dec);
check('다시 저장해도 선분 유지', d.getStaticLineCount() === 400);

// 4) DXF 저장에 읽기 전용 선분이 포함되는지 (Blob을 텍스트로 확인)
const blob = c.exportDxfBlob();
const text = await blob.text();
const lineTags = (text.match(/\nLINE\n/g) || []).length;
check('DXF 저장에 대용량 선분 400개 포함', lineTags >= 400, `(LINE ${lineTags}개)`);

// 저장한 DXF를 다시 읽어 선분이 살아 있는지 확인
const re = new CadModel();
const reRes = re.loadFromDxf(text);
check('저장한 DXF를 다시 읽으면 선분 400개 이상', reRes.lineCount >= 400, `(${reRes.lineCount}개)`);

// 5) 잘못된 파일
let threw = false;
try { decodeLite(new TextEncoder().encode('NOT A LITE FILE AT ALL').buffer); } catch (e) { threw = true; }
check('잘못된 파일은 오류', threw);

console.log('====================================================');
console.log(`   검증 결과 요약: 성공 ${pass}건 / 실패 ${fail}건`);
console.log('====================================================');
if (fail > 0) process.exit(1);

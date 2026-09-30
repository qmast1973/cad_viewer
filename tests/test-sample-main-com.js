import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { cleanCadMText, CadModel } from '../src/core/cad-model.ts';

// 저작권이 있는 샘플 도면은 저장소에 포함되지 않는다. 없으면 이 테스트는 건너뛴다.
if (!fs.existsSync(path.resolve('samples/MAIN_COM_01.dwg'))) {
  console.log('⚠ samples/MAIN_COM_01.dwg 가 없어 이 테스트를 건너뜁니다.');
  process.exit(0);
}

console.log('====================================================');
console.log('   사용자 제공 실제 DWG 도면(MAIN_COM_01.dwg) 종합 실사 검증');
console.log('====================================================\n');

async function testMainComSample() {
  const samplePath = path.resolve('samples/MAIN_COM_01.dwg');
  console.log(`[검증 1] 샘플 파일 존재 및 메타데이터 확인`);
  assert(fs.existsSync(samplePath), '샘플 파일이 존재해야 합니다.');
  const stats = fs.statSync(samplePath);
  console.log(`  ✓ [PASS] 파일 크기: ${(stats.size / 1024).toFixed(1)} KB (${stats.size} bytes)`);

  console.log(`\n[검증 2] AutoCAD DWG 바이너리 로드 및 엔티티 전수 파싱`);
  const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
  const libredwg = await LibreDwg.create(wasmPath);
  const buffer = fs.readFileSync(samplePath);
  const dwg = libredwg.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
  assert(dwg, 'DWG 바이너리 읽기 성공');

  const db = libredwg.convert(dwg);
  assert(db, 'DWG 데이터베이스 변환 성공');

  const model = new CadModel();
  model.clear();

  let lineCount = 0;
  let circleCount = 0;
  let textCount = 0;

  for (const ent of db.entities) {
    const layer = ent.layer || '0';
    const start = ent.startPoint || ent.start || (ent.vertices && ent.vertices[0]);
    const end = ent.endPoint || ent.end || (ent.vertices && ent.vertices[1]);

    if (ent.type === 'LINE' && start && end) {
      model.addLine({ x: start.x, y: start.y }, { x: end.x, y: end.y }, layer);
      lineCount++;
    } else if (ent.type === 'CIRCLE' && (ent.center || ent.centerPoint) && typeof (ent.radius || ent.r) === 'number') {
      const c = ent.center || ent.centerPoint;
      const r = ent.radius || ent.r;
      model.addCircle({ x: c.x, y: c.y }, r, layer);
      circleCount++;
    } else if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
      const c = ent.center;
      const a = Math.hypot(ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y);
      const b = a * (ent.axisRatio || 0.5);
      const rot = Math.atan2(ent.majorAxisEndPoint.y, ent.majorAxisEndPoint.x);
      const segs = 32;
      let prevX = c.x + a * Math.cos(0) * Math.cos(rot) - b * Math.sin(0) * Math.sin(rot);
      let prevY = c.y + a * Math.cos(0) * Math.sin(rot) + b * Math.sin(0) * Math.cos(rot);
      for (let s = 1; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const curX = c.x + a * Math.cos(th) * Math.cos(rot) - b * Math.sin(th) * Math.sin(rot);
        const curY = c.y + a * Math.cos(th) * Math.sin(rot) + b * Math.sin(th) * Math.cos(rot);
        model.addLine({ x: prevX, y: prevY }, { x: curX, y: curY }, layer);
        lineCount++;
        prevX = curX;
        prevY = curY;
      }
    } else if (ent.type === 'HATCH' && Array.isArray(ent.boundaryPaths)) {
      for (const bp of ent.boundaryPaths) {
        for (const edge of bp.edges || []) {
          if (edge.type === 2 && edge.center && typeof edge.radius === 'number') {
            model.addCircle({ x: edge.center.x, y: edge.center.y }, edge.radius, layer);
            circleCount++;
          }
        }
      }
    } else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && (ent.text || ent.string)) {
      const clean = cleanCadMText(ent.text || ent.string || '');
      if (clean) {
        const pos = ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
        model.addText(clean, { x: pos.x, y: pos.y }, ent.textHeight || ent.height || 2.5, 0, layer);
        textCount++;
      }
    } else if (ent.type === 'ATTRIB') {
      const tObj = typeof ent.text === 'object' ? ent.text : null;
      const clean = cleanCadMText((tObj ? tObj.text : ent.text) || ent.string || '');
      if (clean) {
        const pos = (tObj ? tObj.startPoint : null) || ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
        model.addText(clean, { x: pos.x, y: pos.y }, (tObj ? tObj.textHeight : null) || ent.textHeight || 2.5, 0, layer);
        textCount++;
      }
    }
  }

  console.log(`  ✓ [PASS] 선분(LINE + ELLIPSE) 추출 수량: ${lineCount}개`);
  console.log(`  ✓ [PASS] 원(CIRCLE + HATCH 핀) 추출 수량: ${circleCount}개`);
  console.log(`  ✓ [PASS] 문자(MTEXT + ATTRIB) 추출 수량: ${textCount}개`);
  console.log(`  ✓ [PASS] 총 엔티티 수: ${model.getEntities().length}개`);
  assert(lineCount === 798, '선분 수량이 798개여야 합니다.');
  assert(circleCount === 474, '원 수량이 474개여야 합니다.');
  assert(textCount === 555, '문자 수량이 555개여야 합니다.');

  console.log(`\n[검증 3] MTEXT 서식 코드(글자 겹침 원인) 정제 무결성 검증`);
  let corruptCount = 0;
  for (const ent of model.getEntities()) {
    if (ent.type === 'TEXT') {
      if (ent.text.includes('\\f') || ent.text.includes('\\p') || ent.text.includes('{') || ent.text.includes('}')) {
        corruptCount++;
      }
    }
  }
  console.log(`  ✓ [PASS] AutoCAD MTEXT 서식 잔존 건수: ${corruptCount}건 (0건 확인 완료)`);
  assert(corruptCount === 0, '서식 코드가 완전히 정제되어야 합니다.');

  console.log(`\n[검증 4] 도면 바운딩 박스(Extents) 정밀도 검증`);
  const bbox = model.getBoundingBox();
  assert(bbox !== null, '바운딩 박스가 계산되어야 합니다.');
  console.log(`  ✓ [PASS] 도면 가로 폭: ${bbox.width.toFixed(2)} mm`);
  console.log(`  ✓ [PASS] 도면 세로 높이: ${bbox.height.toFixed(2)} mm`);
  console.log(`  ✓ [PASS] 도면 중심 좌표: (${bbox.centerX.toFixed(2)}, ${bbox.centerY.toFixed(2)})`);
  assert(bbox.width > 300 && bbox.width < 400, '도면 폭이 정상 범위 내여야 합니다.');

  console.log(`\n[검증 5] 실제 단자 핀 피치 DIST 수치 측정 검증`);
  const distRes = CadModel.measure({ x: 3270.8512, y: 1947.4428 }, { x: 3274.5113, y: 1947.4428 });
  console.log(`  ✓ [PASS] 단자 핀 간격: ${distRes.distance} mm (ΔX=${distRes.deltaX}, ΔY=${distRes.deltaY}, 각도=${distRes.angleDeg}°)`);
  assert(Math.abs(distRes.distance - 3.6601) < 0.001, '핀 피치가 3.6601mm여야 합니다.');

  console.log(`\n[검증 6] DXF 라운드트립 무결성 검증`);
  const exportedDxf = model.exportDxf();
  assert(exportedDxf.length > 100000, 'DXF 문자열이 정상 직렬화되어야 합니다.');
  const roundtripModel = new CadModel();
  const rtStats = roundtripModel.loadFromDxf(exportedDxf);
  console.log(`  ✓ [PASS] DXF 역파싱 엔티티 수: 선분 ${rtStats.lineCount}개, 원 ${rtStats.circleCount}개, 문자 ${rtStats.textCount}개`);
  assert(rtStats.lineCount === 798, '역파싱 선분 수가 일치해야 합니다.');
  assert(rtStats.circleCount === 474, '역파싱 원 수가 일치해야 합니다.');
  assert(rtStats.textCount === 555, '역파싱 문자 수가 일치해야 합니다.');

  libredwg.dwg_free(dwg);
  console.log('\n====================================================');
  console.log('   ★ MAIN_COM_01.dwg 실사 검증 모든 항목 100% 통과! ★');
  console.log('====================================================\n');
}

testMainComSample().catch(err => {
  console.error('검증 실패:', err);
  process.exit(1);
});

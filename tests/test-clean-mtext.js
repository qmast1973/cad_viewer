import fs from 'fs';
import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

export function cleanCadMText(raw) {
  if (!raw) return '';
  let s = String(raw);

  // 1. 분수 / 스택: \S a^b; -> a/b
  s = s.replace(/\\S([^;^]+)\^([^;]*);/gi, '$1/$2');

  // 2. 폰트/스타일: \f...; 또는 \F...;
  s = s.replace(/\\[fF][^;]*;/g, '');

  // 3. 색상/높이/폭/기울기/정렬/트래킹 등 속성 코드: \C...;, \H...;, \W...;, \Q...;, \A...;, \T...;
  s = s.replace(/\\[cChHwWqQaAtT][^;]*;/g, '');

  // 4. 단락 줄바꿈: \P, \p -> 줄바꿈 공백
  s = s.replace(/\\[pP]/g, ' ');

  // 5. 밑줄/취소선 등 토글 플래그: \L, \l, \O, \o, \K, \k
  s = s.replace(/\\[lLrRoOkK]/g, '');

  // 6. 특수 공백: \~ -> 공백
  s = s.replace(/\\~/g, ' ');

  // 7. 이스케이프 중괄호: \{ -> {, \} -> }
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');

  // 8. 서식 그룹용 중괄호 제거: { 및 }
  s = s.replace(/[{}]/g, '');

  // 9. 이중 백슬래시 축소: \\ -> \
  s = s.replace(/\\\\/g, '\\');

  return s.trim();
}

async function run() {
  const libredwg = await LibreDwg.create(path.resolve('node_modules/@mlightcad/libredwg-web/wasm'));
  const buffer = fs.readFileSync('samples/MAIN_COM_01.dwg');
  const dwg = libredwg.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
  const db = libredwg.convert(dwg);

  const mtexts = db.entities.filter(e => e.type === 'MTEXT');
  console.log(`Total MTEXT count: ${mtexts.length}`);

  const cleanedList = [];
  for (let i = 0; i < Math.min(20, mtexts.length); i++) {
    const raw = mtexts[i].text || mtexts[i].string || '';
    cleanedList.push({
      original: raw,
      cleaned: cleanCadMText(raw)
    });
  }

  console.log('Sample Cleaned MTEXTs:');
  console.table(cleanedList);

  libredwg.dwg_free(dwg);
}

run();

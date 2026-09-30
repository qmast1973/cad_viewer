import fs from 'fs';
import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

async function checkBlockEntities() {
  const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
  const libredwg = await LibreDwg.create(wasmPath);
  const buffer = fs.readFileSync('samples/MAIN_COM_01.dwg');
  const dwg = libredwg.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
  const db = libredwg.convert(dwg);

  const blockEntries = db.tables?.BLOCK_RECORD?.entries || [];
  for (const b of blockEntries) {
    const entCount = b.entities?.length || 0;
    console.log(`Block Record: "${b.name}", entities count: ${entCount}`);
    if (entCount > 0) {
      const types = {};
      for (const e of b.entities) types[e.type] = (types[e.type] || 0) + 1;
      console.log('  Types breakdown:', types);
      console.log('  Sample 3 entities:');
      for (let i = 0; i < Math.min(3, b.entities.length); i++) {
        const ent = b.entities[i];
        console.log(`   [${i}] type=${ent.type}, layer=${ent.layer}, startPoint=${JSON.stringify(ent.startPoint)}, endPoint=${JSON.stringify(ent.endPoint)}, text=${ent.text || ent.string}`);
      }
    }
  }

  libredwg.dwg_free(dwg);
}

checkBlockEntities();

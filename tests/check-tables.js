import fs from 'fs';
import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

async function checkTables() {
  const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
  const libredwg = await LibreDwg.create(wasmPath);
  const buffer = fs.readFileSync('samples/MAIN_COM_01.dwg');
  const dwg = libredwg.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
  const db = libredwg.convert(dwg);

  console.log('=== BLOCK_RECORD table ===');
  console.log(db.tables?.BLOCK_RECORD);

  console.log('\n=== LAYER table ===');
  console.log(db.tables?.LAYER);

  libredwg.dwg_free(dwg);
}

checkTables();

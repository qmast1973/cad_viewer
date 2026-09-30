import fs from 'fs';
import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

async function testSampleDwg() {
  const samplePath = path.resolve('samples/MAIN_COM_01.dwg');
  console.log('Testing sample file:', samplePath);

  if (!fs.existsSync(samplePath)) {
    console.error('File not found:', samplePath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(samplePath);
  console.log('File size:', buffer.byteLength, 'bytes');

  const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
  console.log('Loading LibreDwg from:', wasmPath);

  try {
    const libredwg = await LibreDwg.create(wasmPath);
    console.log('LibreDwg loaded successfully!');

    const uint8Array = new Uint8Array(buffer);
    console.log('Reading DWG data...');
    const dwg = libredwg.dwg_read_data(uint8Array, Dwg_File_Type.DWG);

    if (!dwg) {
      console.error('dwg_read_data returned null/falsy');
      process.exit(1);
    }
    console.log('DWG binary read successful!');

    const db = libredwg.convert(dwg);
    console.log('DWG converted to database successfully!');

    console.log('DB header version:', db?.header?.version);
    console.log('DB entities count:', db?.entities?.length || 0);

    const blocksKeys = Object.keys(db?.blocks || {});
    console.log('DB blocks count:', blocksKeys.length, blocksKeys);

    let totalBlockEntities = 0;
    for (const bk of blocksKeys) {
      const b = db.blocks[bk];
      if (b && Array.isArray(b.entities)) {
        totalBlockEntities += b.entities.length;
      }
    }
    console.log('Total entities inside blocks:', totalBlockEntities);

    // Entity types breakdown
    const typeCounts = {};
    const allEntities = [...(db.entities || [])];
    for (const bk of blocksKeys) {
      if (db.blocks[bk]?.entities) {
        allEntities.push(...db.blocks[bk].entities);
      }
    }

    for (const ent of allEntities) {
      typeCounts[ent.type] = (typeCounts[ent.type] || 0) + 1;
    }

    console.log('Entity breakdown:', JSON.stringify(typeCounts, null, 2));

    libredwg.dwg_free(dwg);
    console.log('Memory freed successfully!');
  } catch (err) {
    console.error('DWG parse error:', err);
  }
}

testSampleDwg();

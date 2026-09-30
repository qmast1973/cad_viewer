import fs from 'fs';
import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';

async function deepInspect() {
  const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
  const libredwg = await LibreDwg.create(wasmPath);
  const buffer = fs.readFileSync('samples/MAIN_COM_01.dwg');
  const dwg = libredwg.dwg_read_data(new Uint8Array(buffer), Dwg_File_Type.DWG);
  const db = libredwg.convert(dwg);

  console.log('=== DB TOP-LEVEL KEYS ===');
  console.log(Object.keys(db));

  console.log('\n=== DB BLOCKS ===');
  for (const [k, v] of Object.entries(db.blocks || {})) {
    console.log(`Block ${k}: name=${v.name}, basePoint=${JSON.stringify(v.basePoint)}, entities=${v.entities?.length}`);
    const types = {};
    for (const e of v.entities || []) types[e.type] = (types[e.type] || 0) + 1;
    console.log('  Entities breakdown:', types);
  }

  console.log('\n=== DB INSERTS (Block References) ===');
  for (const ent of (db.entities || []).filter(e => e.type === 'INSERT')) {
    console.log(`INSERT: name=${ent.name}, pos=${JSON.stringify(ent.insertionPoint || ent.position)}, scale=(${ent.xScale}, ${ent.yScale}), rot=${ent.rotation}`);
    console.log('  Attribs count:', ent.attribs?.length);
  }

  console.log('\n=== ENTITY TYPES in db.entities ===');
  const entTypes = {};
  for (const e of db.entities || []) entTypes[e.type] = (entTypes[e.type] || 0) + 1;
  console.log(entTypes);

  console.log('\n=== LAYERS IN ENTITIES ===');
  const layersBreakdown = {};
  for (const e of db.entities || []) {
    const l = e.layer || '0';
    if (!layersBreakdown[l]) layersBreakdown[l] = {};
    layersBreakdown[l][e.type] = (layersBreakdown[l][e.type] || 0) + 1;
  }
  console.log(JSON.stringify(layersBreakdown, null, 2));

  // Check texts alignment, rotation, font
  console.log('\n=== SAMPLE MTEXT PROPERTIES ===');
  const mtexts = (db.entities || []).filter(e => e.type === 'MTEXT').slice(0, 5);
  for (const m of mtexts) {
    console.log({
      text: m.text || m.string,
      pos: m.insertionPoint || m.startPoint || m.position,
      attachmentPoint: m.attachmentPoint,
      rotation: m.rotation,
      textHeight: m.textHeight || m.height,
      rectWidth: m.rectWidth,
      drawingDirection: m.drawingDirection
    });
  }

  // Check lines properties (color, linetype, lineweight)
  console.log('\n=== SAMPLE LINE PROPERTIES ===');
  const lines = (db.entities || []).filter(e => e.type === 'LINE').slice(0, 5);
  for (const l of lines) {
    console.log({
      start: l.startPoint || l.start,
      end: l.endPoint || l.end,
      color: l.color,
      colorIndex: l.colorIndex,
      lineType: l.lineType,
      lineweight: l.lineweight,
      layer: l.layer
    });
  }

  libredwg.dwg_free(dwg);
}

deepInspect();

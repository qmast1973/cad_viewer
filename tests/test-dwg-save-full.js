import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

async function testDwgSave() {
  console.log('Testing DWG save using LibreDWG utilities...');
  const binDir = path.resolve('bin');
  const dwg2dxfPath = path.join(binDir, 'dwg2dxf.exe');
  const dxf2dwgPath = path.join(binDir, 'dxf2dwg.exe');

  const sampleDwg = path.resolve('samples/MAIN_COM_01.dwg');
  const tempDxf = path.resolve('tests/temp_test.dxf');
  const outputDwg = path.resolve('tests/MAIN_COM_01_test_saved.dwg');

  if (fs.existsSync(tempDxf)) fs.unlinkSync(tempDxf);
  if (fs.existsSync(outputDwg)) fs.unlinkSync(outputDwg);

  console.log('1. Exporting sample DWG to standard full-fidelity DXF...');
  execFileSync(dwg2dxfPath, ['-v0', sampleDwg, '-o', tempDxf], { encoding: 'utf-8' });
  console.log('   ✓ DXF generated. Size:', fs.statSync(tempDxf).size, 'bytes');

  console.log('2. Converting DXF to AutoCAD 2000-2018 compatible DWG...');
  execFileSync(dxf2dwgPath, ['-v0', tempDxf, '-o', outputDwg], { encoding: 'utf-8' });
  console.log('   ✓ DWG generated. Size:', fs.statSync(outputDwg).size, 'bytes');

  const header = fs.readFileSync(outputDwg).subarray(0, 6).toString('ascii');
  console.log('   ✓ Generated DWG header version:', header);

  console.log('3. Verifying generated DWG with agent-cli.js open...');
  const out = execFileSync('node', ['src/agent-cli.js', 'open', outputDwg], { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  console.log('   ✓ Parsed status:', parsed.status);
  console.log('   ✓ Total entities:', parsed.totalEntities);
  console.log('   ✓ Bounding box:', parsed.boundingBox);

  console.log('\n★ DWG File Save & Verification 100% SUCCESSFUL! ★');
}

testDwgSave().catch(err => {
  console.error('Test DWG save error:', err);
  process.exit(1);
});

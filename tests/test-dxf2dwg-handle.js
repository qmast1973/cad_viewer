import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import Drawing from 'dxf-writer';

async function testHandleFix() {
  const Handle = (await import('../node_modules/dxf-writer/src/Handle.js')).default;
  Handle.seed = 0x1000; // 4096부터 시작

  const d = new Drawing();
  d.setUnits('Millimeters');
  d.addLayer('WALL', Drawing.ACI.CYAN, 'CONTINUOUS');
  d.setActiveLayer('WALL');
  d.drawLine(0, 0, 100, 0);
  d.drawLine(100, 0, 100, 100);
  d.drawLine(100, 100, 0, 100);
  d.drawLine(0, 100, 0, 0);
  d.drawCircle(50, 50, 25);
  d.drawText(20, 20, 5, 0, 'SAMPLE DWG EXPORT');

  const dxfPath = path.resolve('tests/sample_fixed_seed.dxf');
  const dwgPath = path.resolve('tests/sample_fixed_seed.dwg');
  fs.writeFileSync(dxfPath, d.toDxfString(), 'utf-8');

  console.log('DXF written, converting to DWG using bin/dxf2dwg.exe...');
  const dxf2dwgPath = path.resolve('bin/dxf2dwg.exe');

  try {
    const out = execFileSync(dxf2dwgPath, ['-y', '-v0', dxfPath, '-o', dwgPath], { encoding: 'utf-8' });
    console.log('dxf2dwg output:', out);
  } catch (err) {
    console.log('dxf2dwg stderr:', err.stderr?.toString());
    console.log('dxf2dwg stdout:', err.stdout?.toString());
  }

  if (fs.existsSync(dwgPath)) {
    const stats = fs.statSync(dwgPath);
    console.log(`★ DWG File successfully created! ★ Size: ${stats.size} bytes`);
    const header = fs.readFileSync(dwgPath).subarray(0, 6).toString('ascii');
    console.log('DWG Header version:', header);
  } else {
    console.log('DWG file was not created.');
  }
}

testHandleFix();

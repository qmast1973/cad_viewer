const { convertDwgToDxf } = require('dwg2dxf-converter');
const path = require('path');
const fs = require('fs');

async function test() {
  const dwgPath = path.resolve(__dirname, '../sample/sample.dwg');
  const dxfPath = path.resolve(__dirname, '../sample/sample_converted.dxf');

  console.log('DWG 변환 시작:', dwgPath);
  const result = await convertDwgToDxf(dwgPath, dxfPath);
  console.log('변환 결과:', result);

  if (fs.existsSync(dxfPath)) {
    const stat = fs.statSync(dxfPath);
    console.log('생성된 DXF 파일 크기:', stat.size, 'bytes');
  }
}

test().catch(console.error);

const { convertDwgToDxf } = require('dwg2dxf-converter');
const [,, inPath, outPath] = process.argv;

if (!inPath || !outPath) {
  console.error('Usage: node convert_cli.js <input.dwg> <output.dxf>');
  process.exit(1);
}

convertDwgToDxf(inPath, outPath)
  .then(res => {
    if (res.success) {
      process.exit(0);
    } else {
      console.error(res.error || (res.warnings ? res.warnings.join('; ') : 'Conversion failed'));
      process.exit(1);
    }
  })
  .catch(err => {
    console.error(err.message || String(err));
    process.exit(1);
  });

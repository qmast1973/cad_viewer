const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { convert: convertLite } = require('./dwg_lite');

const PORT = 8795;
const BASE_DIR = path.resolve(__dirname, '..');
const CONVERT_SCRIPT = path.join(__dirname, 'convert_cli.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.dxf': 'text/plain; charset=utf-8',
  '.dwg': 'application/acad',
  '.cadlite': 'application/octet-stream',
  '.stl': 'model/stl',
  '.obj': 'text/plain; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // 큰 도면용: 원본 LibreDWG(dwg2dxf.exe)로 변환 → 가벼운 도면(cadlite) 이진으로 줄여 돌려줌. 같은 파일은 캐시를 다시 쓴다.
  if (req.method === 'POST' && pathname === '/api/dwg-lite') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      let tempDwg = null;
      try {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '전송된 DWG 파일 데이터가 비어 있습니다.' }));
          return;
        }
        const hash = crypto.createHash('sha1').update(buffer).digest('hex');
        const cacheDir = path.join(os.tmpdir(), 'cad-viewer-cache');
        await fs.promises.mkdir(cacheDir, { recursive: true });
        const lite = path.join(cacheDir, `${hash}.v2.cadlite`);
        let cached = true;
        if (!fs.existsSync(lite)) {
          cached = false;
          tempDwg = path.join(cacheDir, `${hash}.dwg`);
          await fs.promises.writeFile(tempDwg, buffer);
          await convertLite(tempDwg, lite);
        }
        const data = await fs.promises.readFile(lite);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'X-Cache': cached ? 'hit' : 'miss' });
        res.end(data);
      } catch (err) {
        console.error('[API 에러] DWG 변환(lite) 실패:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        if (tempDwg) { try { await fs.promises.unlink(tempDwg); } catch (e) {} }
      }
    });
    return;
  }

  // DWG 변환 API 엔드포인트 (독립 자식 프로세스로 격리 실행 -> Wasm 메모리 오염 원천 방지)
  if (req.method === 'POST' && pathname === '/api/convert-dwg') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      let tempDwg = null;
      let tempDxf = null;
      try {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '전송된 DWG 파일 데이터가 비어 있습니다.' }));
          return;
        }

        const tempId = `cad_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        tempDwg = path.join(os.tmpdir(), `${tempId}.dwg`);
        tempDxf = path.join(os.tmpdir(), `${tempId}.dxf`);

        await fs.promises.writeFile(tempDwg, buffer);

        // 독립 Node 프로세스로 격리 변환 실행 (4GB 힙 할당)
        await new Promise((resolve, reject) => {
          execFile('node', ['--max-old-space-size=4096', CONVERT_SCRIPT, tempDwg, tempDxf], {
            timeout: 30000,
            windowsHide: true
          }, (err, stdout, stderr) => {
            if (err) {
              const msg = stderr ? stderr.trim() : (err.message || '변환 프로세스 오류');
              reject(new Error(msg));
            } else {
              resolve();
            }
          });
        });

        if (!fs.existsSync(tempDxf)) {
          throw new Error('변환 결과 DXF 파일이 생성되지 않았습니다.');
        }

        const dxfText = await fs.promises.readFile(tempDxf, 'utf-8');

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(dxfText);
      } catch (err) {
        console.error('[API 에러] DWG 변환 실패:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        if (tempDwg) { try { await fs.promises.unlink(tempDwg); } catch (e) {} }
        if (tempDxf) { try { await fs.promises.unlink(tempDxf); } catch (e) {} }
      }
    });
    return;
  }

  // 정적 파일 서빙
  let filePath = path.join(BASE_DIR, pathname === '/' ? 'index.html' : pathname);
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const content = await fs.promises.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${pathname}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CAD Viewer Server] 실행 중: http://127.0.0.1:${PORT}`);
  console.log(`[DWG Converter] 독립 격리 프로세스 모드로 가동 완료 (/api/convert-dwg)`);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { convert: convertLite } = require('./dwg_lite');


// 편집 서버(Rust: bin/dwg2lite.exe --edit-server): 한 줄 명령 → 한 줄 JSON. 도면을 메모리에 들고 있어서 한 번 띄워 계속 쓴다. 요청은 차례로 처리한다.
const { spawn } = require('child_process');
let editProc = null, editBuf = '', editChain = Promise.resolve();
const editWaiters = [];
function editStart() {
  if (editProc && !editProc.killed && editProc.exitCode === null) return;
  const exe = path.join(__dirname, '..', 'bin', 'dwg2lite.exe');
  if (!fs.existsSync(exe)) throw new Error('bin/dwg2lite.exe 가 없습니다(편집 기능에 필요)');
  editProc = spawn(exe, ['--edit-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  editBuf = '';
  editProc.stdout.setEncoding('utf8');
  editProc.stdout.on('data', (d) => {
    editBuf += d; let i;
    while ((i = editBuf.indexOf('\n')) >= 0) {
      const line = editBuf.slice(0, i); editBuf = editBuf.slice(i + 1);
      const w = editWaiters.shift();
      if (w) { try { w(JSON.parse(line)); } catch (e) { w({ ok: false, error: '편집 서버 응답 오류' }); } }
    }
  });
  editProc.stderr.on('data', (d) => console.error('[edit-server]', String(d).slice(0, 300)));
  editProc.on('exit', () => { editProc = null; while (editWaiters.length) editWaiters.shift()({ ok: false, error: '편집 서버가 종료됨' }); });
}
function editLine(line) {                  // 한 줄 보내고 한 줄 답 받기(앞선 요청이 끝난 뒤에)
  const run = () => new Promise((resolve) => { try { editStart(); } catch (e) { return resolve({ ok: false, error: e.message }); } editWaiters.push(resolve); editProc.stdin.write(line + '\n'); });
  const p = editChain.then(run, run); editChain = p.catch(() => {}); return p;
}
process.on('exit', () => { try { editProc && editProc.kill(); } catch (e) {} });

const PORT = Number(process.env.CAD_PORT) || 8795;          // 데스크톱 앱(Electron)은 빈 포트와 127.0.0.1 만 쓴다
const HOST = process.env.CAD_HOST || '0.0.0.0';
const BASE_DIR = path.resolve(__dirname, '..');
const SAVE_DIR = process.env.CAD_SAVE_DIR || path.join(BASE_DIR, '저장');       // 편집 결과 저장 위치
const CONVERT_SCRIPT = path.join(__dirname, 'convert_cli.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

  // 큰 도면용: Rust 변환기(bin/dwg2lite.exe)로 변환 → 가벼운 도면(cadlite) 이진으로 줄여 돌려줌. 같은 파일은 캐시를 다시 쓴다.
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
        const isDxf = url.searchParams.get('type') === 'dxf';           // DXF 는 변환 단계 없이 바로 줄인다
        const lite = path.join(cacheDir, `${hash}${isDxf ? '.dxf' : ''}.v8.cadlite`);
        let cached = true;
        if (!fs.existsSync(lite)) {
          cached = false;
          tempDwg = path.join(cacheDir, `${hash}.${isDxf ? 'dxf' : 'dwg'}`);
          await fs.promises.writeFile(tempDwg, buffer);
          await convertLite(tempDwg, lite, undefined, { dxf: isDxf });
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


  // ── 부품(블록) 이동·복사 편집 API (이 PC 안에서만: 127.0.0.1 요청만 받음). 원본은 고치지 않고 '저장/' 폴더에 새 DXF 로만 쓴다. ──
  if (pathname.startsWith('/api/edit/')) {
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '편집 기능은 이 PC 에서만 쓸 수 있습니다.' }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
      try {
        const body = Buffer.concat(chunks);
        const cmd = pathname.slice('/api/edit/'.length);
        if (cmd === 'open') {
          if (body.length === 0) return send(400, { error: '도면 데이터가 비어 있습니다.' });
          const typ = url.searchParams.get('type') === 'dxf' ? 'dxf' : 'dwg';
          const hash = crypto.createHash('sha1').update(body).digest('hex');
          const cacheDir = path.join(os.tmpdir(), 'cad-viewer-cache');
          await fs.promises.mkdir(cacheDir, { recursive: true });
          const srcPath = path.join(cacheDir, `${hash}.edit.${typ}`);
          if (!fs.existsSync(srcPath)) await fs.promises.writeFile(srcPath, body);
          const r = await editLine(`open ${typ} ${srcPath}`);
          return send(r.ok ? 200 : 500, r);
        }
        if (cmd === 'pick') {
          const j = JSON.parse(body.toString('utf8'));
          const r = await editLine(`pick ${Number(j.x)} ${Number(j.y)} ${Number(j.tol) || 0}`);
          return send(r.ok ? 200 : 500, r);
        }
        if (cmd === 'list') {
          const r = await editLine('list 8');
          return send(r.ok ? 200 : 500, r);
        }
        if (cmd === 'save') {
          const j = JSON.parse(body.toString('utf8'));
          const fmt = j.format === 'dwg' ? 'dwg' : 'dxf';
          const ops = (j.ops || []).filter((o) => (o.op === 'move' || o.op === 'copy') && /^\d+$/.test(String(o.handle)) && isFinite(o.dx) && isFinite(o.dy));
          if (!ops.length) return send(400, { error: '저장할 변경이 없습니다.' });
          const outDir = SAVE_DIR;
          await fs.promises.mkdir(outDir, { recursive: true });
          const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
          const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
          const stem = String(j.stem || 'drawing').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80);
          let out = path.join(outDir, `${stem}_수정_${stamp}.${fmt}`), k = 2;
          while (fs.existsSync(out)) out = path.join(outDir, `${stem}_수정_${stamp}(${k++}).${fmt}`);
          const opsFile = path.join(os.tmpdir(), `cad-edit-ops-${Date.now()}.txt`);
          await fs.promises.writeFile(opsFile, ops.map((o) => `${o.op} ${o.handle} ${o.dx} ${o.dy}`).join('\n') + '\n', 'utf8');
          const r = await editLine(`save ${fmt} ${opsFile} ${out}`);
          fs.promises.unlink(opsFile).catch(() => {});
          if (r.ok) r.file = path.basename(out);
          return send(r.ok ? 200 : 500, r);
        }
        if (cmd === 'download') {                                    // 저장 폴더의 파일을 내려받기(폴더 밖 경로는 거부)
          const f = path.basename(url.searchParams.get('f') || '');
          const p = path.join(SAVE_DIR, f);
          if (!f || !fs.existsSync(p)) return send(404, { error: '파일 없음' });
          const data = await fs.promises.readFile(p);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f) });
          return res.end(data);
        }
        return send(404, { error: '알 수 없는 편집 명령' });
      } catch (err) {
        console.error('[API 에러] 편집 실패:', err.message);
        send(500, { error: err.message });
      }
    });
    return;
  }

  // 데스크톱 앱: 실행할 때 넘겨받은 도면 파일 한 개(CAD_OPEN)를 화면에 건네준다. 이 PC(127.0.0.1)에서만, 확장자 제한.
  if (req.method === 'GET' && pathname === '/api/open-arg') {
    const ra = req.socket.remoteAddress || '';
    const f = process.env.CAD_OPEN || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1') || !f || !/\.(dwg|dxf|stl|obj)$/i.test(f) || !fs.existsSync(f)) {
      res.writeHead(204);
      res.end();
      return;
    }
    const data = await fs.promises.readFile(f);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'X-File-Name': encodeURIComponent(path.basename(f)) });
    res.end(data);
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

server.listen(PORT, HOST, () => {
  console.log(`[CAD Viewer Server] 실행 중: http://127.0.0.1:${PORT}`);
  console.log(`[DWG Converter] 독립 격리 프로세스 모드로 가동 완료 (/api/convert-dwg)`);
});

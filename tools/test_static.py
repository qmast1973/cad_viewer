"""서버 없이(깃허브 페이지처럼 파일만 주는 정적 서버) 큰 DWG 가 브라우저 안 wasm 변환기로 열리는지 시험.
  python tools/test_static.py <dwg> [스크린샷 폴더] [--mobile]
정적 서버는 파이썬 http.server(POST 는 405 로 거절 = /api/dwg-lite 없음). 헤드리스 Chrome, 소리 끔, 끝나면 모두 종료."""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, time
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DWG = args[0] if args else ''
OUT = args[1] if len(args) > 1 else tempfile.gettempdir()
MOBILE = '--mobile' in sys.argv
SAMPLE = next((a[9:] for a in sys.argv if a.startswith('--sample=')), None)   # 예: --sample=sample.dwg (파일 선택 대신 샘플 목록에서 고름)
LIVE = next((a[6:] for a in sys.argv if a.startswith('--url=')), None)   # 예: --url=https://qmast1973.github.io/cad_viewer/  (실제 배포본 시험)
PORT, DBG = 8796, 9342
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info)
    if not ok:
        fails.append(name)


async def main():
    srv = None if LIVE else subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=1280,800', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', (LIVE or f'http://127.0.0.1:{PORT}/') + 'index.html'])
    try:
        await asyncio.sleep(5)
        tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{DBG}/json').read().decode())
        target = [t for t in tabs if t.get('type') == 'page' and (LIVE.split('//')[1].split('/')[0] if LIVE else str(PORT)) in t.get('url', '')][0]
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=None) as ws:
            n = 0

            async def send(m, p=None):
                nonlocal n
                n += 1
                await ws.send(json.dumps({'id': n, 'method': m, 'params': p or {}}))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get('method') == 'Page.javascriptDialogOpening':
                        dialogs.append(r['params']['message'])
                        await ws.send(json.dumps({'id': 9000 + len(dialogs), 'method': 'Page.handleJavaScriptDialog', 'params': {'accept': True}}))
                    if r.get('id') == n:
                        return r.get('result', {})

            dialogs = []

            async def ev(js):
                r = await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    return 'EXC ' + str(r['exceptionDetails'].get('exception', {}).get('description', ''))[:300]
                return r.get('result', {}).get('value')

            await send('Page.enable')
            await send('Emulation.setDeviceMetricsOverride', {'width': 390 if MOBILE else 1280, 'height': 844 if MOBILE else 800, 'deviceScaleFactor': 1, 'mobile': MOBILE})
            post = await ev("fetch('/api/dwg-lite',{method:'POST',body:'x'}).then(r=>r.status)")
            check("서버 변환(/api)이 없는 주소", post in (404, 405, 501), post)
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await ev("document.getElementById('status-stats').textContent = ''")
            t0 = time.time()
            if SAMPLE:
                await ev("(()=>{const s=document.querySelector('select');s.value=%s;s.dispatchEvent(new Event('change'));})()" % json.dumps(SAMPLE))
            else:
                await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
            st = ''
            for _ in range(400):
                await asyncio.sleep(1)
                st = await ev("document.getElementById('status-stats').textContent")
                if '선분' in (st or '') or dialogs:
                    break
            took = time.time() - t0
            check("서버 없이 DWG 가 열림(경고창 없음)", '선분' in (st or '') and not dialogs, f"{took:.1f}초 {st} {dialogs}")
            await asyncio.sleep(3)
            print("        상태줄:", st, "| 경고창:", dialogs)
            info = json.loads(await ev("(()=>{const a=window.cadViewer.app,l=a.lite;return JSON.stringify({engine:l&&l.head.stats.engine,ver:l&&l.head.version,segs:l&&l.head.stats.segments,texts:l&&l.head.texts.length,layers:l&&l.head.layers.length,lines:l&&l.lines.length})})()"))
            check("Rust(wasm) 변환기가 만든 v2 도면", info.get('engine') == 'acadrust-direct-v2' and info.get('ver') == 2, info)
            err = await ev("(()=>{const a=window.cadViewer.app,gl=a.renderer.getContext();gl.getError();a.renderer.render(a.scene,a.camera);return gl.getError()})()")
            check("그래픽 오류 없음", err == 0, err)
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            Path(OUT, 'static_open.png').write_bytes(base64.b64decode(shot['data']))
            import io
            import numpy as np
            from PIL import Image
            im = np.array(Image.open(io.BytesIO(base64.b64decode(shot['data']))).convert('RGB')).astype(int)
            nonbg = int((np.abs(im - im[400, 5]).sum(axis=2) > 40).sum())
            check("화면에 도면이 그려짐(배경과 다른 픽셀 많음)", nonbg > 5000, nonbg)
            mem = await ev("(()=>{const m=performance.memory;return m?Math.round(m.usedJSHeapSize/1e6):null})()")
            print("        JS 메모리(MB):", mem)
    finally:
        proc.terminate(); srv and srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

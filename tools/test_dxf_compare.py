"""같은 DXF 를 (1) 새 방식(wasm → 가벼운 도면)과 (2) 예전 방식(renderDxf)으로 그려 화면을 비교한다(정적 서버, 헤드리스 Chrome).
  python tools/test_dxf_compare.py <dxf> <스크린샷 폴더>"""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, io, time
from pathlib import Path
import numpy as np
from PIL import Image
import websockets
ROOT = str(Path(__file__).resolve().parent.parent)
DXF, OUT = sys.argv[1], sys.argv[2]
PORT, DBG = 8797, 9370
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=1280,800', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', f'http://127.0.0.1:{PORT}/index.html'])
    try:
        tabs = None
        for _ in range(30):                      # 크롬이 준비될 때까지 기다린다(고정 대기 대신)
            await asyncio.sleep(1)
            try:
                tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{DBG}/json', timeout=3).read().decode())
                if any(str(PORT) in x.get('url', '') for x in tabs): break
            except Exception:
                pass
        t = [x for x in tabs if x.get('type') == 'page' and str(PORT) in x.get('url', '')][0]
        async with websockets.connect(t['webSocketDebuggerUrl'], max_size=None) as ws:
            n = 0
            async def send(m, p=None):
                nonlocal n
                n += 1
                await ws.send(json.dumps({'id': n, 'method': m, 'params': p or {}}))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get('id') == n:
                        return r.get('result', {})
            async def ev(js):
                r = await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})
                return r.get('result', {}).get('value') if 'exceptionDetails' not in r else 'EXC ' + str(r['exceptionDetails'])[:200]
            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            async def shot(name):
                r = await send('Page.captureScreenshot', {'format': 'png'})
                b = base64.b64decode(r['data']); Path(OUT, name).write_bytes(b)
                return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(int)
            shots = {}
            for mode in ('new', 'old'):
                await send('Page.navigate', {'url': f'http://127.0.0.1:{PORT}/index.html'})
                await asyncio.sleep(4)
                if mode == 'old':     # wasm 작업자를 막아 예전 방식(renderDxf)으로 열리게 한다
                    await ev("window.Worker = undefined")
                doc = await send('DOM.getDocument')
                node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
                await ev("document.getElementById('status-stats').textContent = ''")
                await send('DOM.setFileInputFiles', {'files': [DXF], 'nodeId': node['nodeId']})
                st = ''
                for _ in range(120):
                    await asyncio.sleep(1)
                    st = await ev("document.getElementById('status-stats').textContent")
                    if st: break
                await asyncio.sleep(3)
                print(mode, '상태줄:', st)
                shots[mode] = await shot(f'dxf_{mode}.png')
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    def pal(im):
        px = im[100:1900 if im.shape[0] > 1900 else im.shape[0] - 30].reshape(-1, 3)
        bg = np.array([px[0]])
        keys = [tuple((p // 32 * 32)) for p in px[::7] if np.abs(p - bg).sum() > 120]
        from collections import Counter
        return Counter(keys).most_common(6)
    for k in ('new', 'old'):
        print(k, '주요 색(32단위 묶음):', pal(shots[k]))
asyncio.run(main())

"""휠 확대가 끝까지(약 500배) 되는지 시험 — 정적 서버(깃허브 페이지와 같은 방식, wasm 변환)로 큰 도면을 열고 휠을 돌린다.
  python -X utf8 tools/test_wheel_deep.py <도면.dwg> [--url=https://...]
확인: 휠을 돌릴수록 카메라 거리가 줄어 확대 배율이 500배 이상이 되고, 중간에 멈추지 않으며, 깊게 확대해도 화면에 선이 그려진다."""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, time, io
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DWG = os.path.abspath(args[0])
LIVE = next((a[6:] for a in sys.argv if a.startswith('--url=')), None)
OUT = os.environ.get('TEMP', '.')
PORT, DBG = 8796, 9342
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info, flush=True)
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
        key = LIVE.split('//')[1].split('/')[0] if LIVE else str(PORT)
        target = [t for t in tabs if t.get('type') == 'page' and key in t.get('url', '')][0]
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=None) as ws:
            n = 0

            async def send(m, p=None):
                nonlocal n
                n += 1
                await ws.send(json.dumps({'id': n, 'method': m, 'params': p or {}}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), 300))
                    if r.get('id') == n:
                        return r.get('result', {})

            async def ev(js):
                r = await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    print('   JS 오류:', json.dumps(r['exceptionDetails'], ensure_ascii=False)[:300])
                return r.get('result', {}).get('value')

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
            for _ in range(300):
                await asyncio.sleep(1)
                if await ev("(window.cadViewer.app.lite ? window.cadViewer.app.lite.texts.length : 0) > 1000"):
                    break
            await asyncio.sleep(2)
            fit = await ev("window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)")
            print('  .. 열림, 맞춤 거리', round(fit), flush=True)
            # 내용이 있는 곳(글자 '1807')을 화면 가운데로 옮기고 그 위에서 확대(실제로 쓰는 방식)
            xy = await ev("(()=>{const a=window.cadViewer.app;window.cadTools.find('1807');const r=window.cadTools.findResults();if(!r.length)return null;const o=a.lite.head.origin;return [r[0].x-o[0],r[0].y-o[1]]})()")
            if xy:
                await ev("(()=>{const a=window.cadViewer.app;a.controls.target.set(%f,%f,0);a.camera.position.set(%f,%f,a.camera.position.z);a.controls.update();window.cadTools.find('');a.textsDirty=true;return 1})()" % (xy[0], xy[1], xy[0], xy[1]))
                await asyncio.sleep(1)
            last, stall = fit, 0
            ratio = 1.0
            for k in range(1, 1201):
                await send('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': int(os.environ.get('WX', 640)), 'y': int(os.environ.get('WY', 400)), 'deltaX': 0, 'deltaY': -100})
                if k % 10 == 0:
                    await asyncio.sleep(0.2)
                    d = await ev("window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)")
                    ratio = fit / d
                    if k % 50 == 0:
                        print(f'  휠 {k}번: 거리 {d:.2f} 배율 {ratio:.0f}x', flush=True)
                    stall = stall + 1 if abs(d - last) < 1e-9 * max(d, 1) else 0
                    last = d
                    if ratio >= float(os.environ.get('STOPAT', 500)) or stall >= 3:
                        break
            check("휠로 목표 배율까지 확대됨(중간에 멈추지 않음)", ratio >= float(os.environ.get('STOPAT', 500)), f"{ratio:.0f}배, 휠 {k}번")
            cam = json.loads(await ev("JSON.stringify({near:window.cadViewer.app.camera.near,far:window.cadViewer.app.camera.far,d:window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)})"))
            st = await ev("document.getElementById('status-scale') && document.getElementById('status-scale').textContent")
            check("상태줄에 확대 정도(축척·배율)가 표시됨", bool(st) and '배' in st, st)
            check("카메라 가까운 면이 거리보다 작음", cam['near'] < cam['d'], cam)
            r = await send('Page.captureScreenshot', {'format': 'png'})
            Path(OUT, os.environ.get('SHOT', 'wheel_deep.png')).write_bytes(base64.b64decode(r['data']))
    finally:
        proc.terminate(); srv and srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

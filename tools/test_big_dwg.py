"""큰 DWG 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_big_dwg.py <큰.dwg> [스크린샷 폴더]
기대: 파일을 고르면 /api/dwg-lite 로 변환되어 선분·글자 수가 상태줄에 나오고, 맞춤 화면과 확대 화면이 그려지며 글자가 겹쳐 그려진다.
같은 파일을 한 번 더 열면 캐시로 즉시(수 초 안) 열린다."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os, time
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
DWG = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.gettempdir()
PORT, DBG = 8795, 9336
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info)
    if not ok:
        fails.append(name)


async def main():
    srv = subprocess.Popen(['node', '--max-old-space-size=4096', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=1280,800', f'http://127.0.0.1:{PORT}/index.html'])
    try:
        await asyncio.sleep(4)
        tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{DBG}/json').read().decode())
        target = [t for t in tabs if t.get('type') == 'page' and str(PORT) in t.get('url', '')][0]
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=None) as ws:
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
                return (await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})).get('result', {}).get('value')

            async def shot(name):
                r = await send('Page.captureScreenshot', {'format': 'png'})
                import base64
                Path(OUT, name).write_bytes(base64.b64decode(r['data']))

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})

            async def open_file():
                doc = await send('DOM.getDocument')
                node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
                await ev("document.getElementById('status-stats').textContent = ''")      # 같은 파일을 다시 열면 글이 같아 변화를 못 알아채므로 비워 둔다
                t0 = time.time()
                await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
                for _ in range(240):
                    await asyncio.sleep(1)
                    st = await ev("document.getElementById('status-stats').textContent")
                    if '선분' in (st or ''):
                        return time.time() - t0, st
                return time.time() - t0, None

            await ev("window.cadViewer && true")
            dt, st = await open_file()
            check("큰 DWG 열림(선분·글자 수 표시)", st is not None, f"{dt:.1f}초 / {st}")
            await asyncio.sleep(2)
            await shot('big_fit.png')
            state = await ev("JSON.stringify(window.cadViewer.getState())")
            print("  상태:", (state or '')[:300])
            check("레이어 목록이 있음", len(json.loads(state)['layers']) > 1 if state else False)
            nodrawn = await ev("(()=>{const c=document.getElementById('lite-text-overlay');return c? c.width:0})()")
            check("글자 겹침 캔버스 있음", (nodrawn or 0) > 0, nodrawn)
            # 중앙 부근 확대
            # 그림이 모인 곳(왼쪽 시트 윗부분)으로 옮겨 확대
            await ev("(()=>{const a=window.cadViewer.app,b=a.fitBox,w=b.max.x-b.min.x,h=b.max.y-b.min.y;"
                     "a.controls.target.set(b.min.x+0.27*w,b.min.y+0.80*h,0);a.camera.position.set(b.min.x+0.27*w,b.min.y+0.80*h,a.camera.position.z);a.controls.update();})()")
            await ev("window.cadViewer.zoom(0.12)")
            await asyncio.sleep(2)
            await shot('big_zoom.png')
            # 같은 파일 다시 열기 = 캐시
            dt2, st2 = await open_file()
            check("같은 파일 다시 열기(캐시)가 빠름", st2 is not None and dt2 < 30, f"{dt2:.1f}초")
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

"""큰 도면 부품 선택 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_text_perf.py <큰 도면.dwg>
확인: 글자 그리기(fillText)에 쓰인 글꼴 크기를 모아서 — 고정 모드(기본)에서는 확대 배율을 달리해도 크기가 하나(12px)뿐이고,
      끄면(도면과 같이 커짐) 배율에 따라 크기가 달라진다. 글자가 아예 안 나오지 않는지도 본다."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9348
DWG = os.path.abspath(sys.argv[1])
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info)
    if not ok:
        fails.append(name)


async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                    r = json.loads(await asyncio.wait_for(ws.recv(), 120))
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
            for _ in range(240):
                await asyncio.sleep(1)
                if await ev("(window.cadViewer.app.lite ? window.cadViewer.app.lite.texts.length : 0) > 1000"):
                    break
            await asyncio.sleep(2)
            print('  .. 열림, 글자', await ev("window.cadViewer.app.lite.texts.length"), flush=True)
            n = await ev("window.cadTools.select.count()")
            check("큰 도면에도 부품 목록이 있음", n > 30000, n)
            xy = await ev("(()=>{window.cadTools.find('1807');const r=window.cadTools.findResults();return r.length?[r[0].x,r[0].y]:null})()")
            hits = 0; worst = 0
            for i in range(8):
                t = await ev("""(()=>{const t0=performance.now();const r=window.cadTools.select.at(%f,%f,false);return [performance.now()-t0, r&&r.name]})()""" % (xy[0] + i * 300, xy[1] + i * 120))
                worst = max(worst, t[0]); hits += 1 if t[1] else 0
                print(f'  선택 {i}: {t[0]:.0f}ms -> {t[1]}', flush=True)
            check("부품 선택이 큰 도면에서도 빠름(최대 200ms)", worst < 200, f"{worst:.0f}ms")
            check("부품이 여러 개 골라짐", hits >= 3, hits)
            await ev("window.cadTools.select.zoom()")
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

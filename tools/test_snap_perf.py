"""큰 도면 스냅 계산 속도 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_text_perf.py <큰 도면.dwg>
확인: 글자 그리기(fillText)에 쓰인 글꼴 크기를 모아서 — 고정 모드(기본)에서는 확대 배율을 달리해도 크기가 하나(12px)뿐이고,
      끄면(도면과 같이 커짐) 배율에 따라 크기가 달라진다. 글자가 아예 안 나오지 않는지도 본다."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9346
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
            # 내용이 있는 곳(글자 '1807' 위치)으로 옮겨서 스냅 계산 시간을 잰다(클릭 때 계산)
            xy = await ev("(()=>{const a=window.cadViewer.app;window.cadTools.find('1807');const r=window.cadTools.findResults();return r.length?[r[0].x,r[0].y]:null})()")
            print('  .. 위치', xy, flush=True)
            for f, label in ((4000, '넓게(축척 큼)'), (400, '중간'), (40, '확대')):
                await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (xy[0] - f * 8, xy[1] - f * 5, xy[0] + f * 8, xy[1] + f * 5))
                await asyncio.sleep(1.0)
                ms = await ev("""(()=>{const t0=performance.now();let n=0,hit=0;for(let i=0;i<5;i++){const r=window.cadTools.snap.at(%f+i*%f,%f,14);n++;if(r)hit++}return [(performance.now()-t0)/n,hit]})()""" % (xy[0], f * 0.3, xy[1]))
                print(f'  스냅 계산 {label}: {ms[0]:.0f}ms/회, 붙은 횟수 {ms[1]}/5', flush=True)
                check(f"스냅 계산이 {label}에서 1초 안", ms[0] < 1000, f"{ms[0]:.0f}ms")
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

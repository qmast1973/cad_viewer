"""큰 도면(블록 삽입 많음, 예: PLC#1_10 판넬배치도)에서 터치로 끌 때 끝점 스냅이 잡히는지 시험.
  python -X utf8 tools/test_touch_snap_big.py <큰.dwg>   (헤드리스 Chrome, 소리 끔, 끝나면 서버·브라우저 종료)
(무작위 12곳 중 10곳 이상이면 통과: 자르기 영역 밖 점은 안 그려져 가끔 빠짐) 수정 전에는 1억 점 이상 도면에서 끌 때 스냅 계산을 꺼 놓아 0/12 였다."""
import asyncio, json, urllib.request, subprocess, tempfile, shutil, os, sys, base64
import websockets
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); F = sys.argv[1]
PORT, DBG = 8795, 9353
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--mute-audio', '--no-first-run', '--window-size=420,860', f'http://127.0.0.1:{PORT}/index.html'])
    try:
        await asyncio.sleep(4)
        tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{DBG}/json').read().decode())
        t = [x for x in tabs if x.get('type') == 'page' and str(PORT) in x.get('url', '')][0]
        async with websockets.connect(t['webSocketDebuggerUrl'], max_size=None) as ws:
            n = 0
            async def ev(js):
                nonlocal n; n += 1
                await ws.send(json.dumps({'id': n, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True, 'awaitPromise': True}}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), 200))
                    if r.get('id') == n: return r.get('result', {}).get('result', {}).get('value') if 'exceptionDetails' not in r.get('result', {}) else r['result']['exceptionDetails']['exception']['description'][:200]
            async def send(m, pr=None):
                nonlocal n; n += 1
                await ws.send(json.dumps({'id': n, 'method': m, 'params': pr or {}}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), 200))
                    if r.get('id') == n: return r.get('result', {})
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await send('DOM.setFileInputFiles', {'files': [os.path.abspath(F)], 'nodeId': node['nodeId']})
            for _ in range(240):
                await asyncio.sleep(1)
                if await ev("!!window.cadViewer.app.lite && window.cadViewer.app.lite.lines.length>0 && window.cadViewer.app.lite.lines[0].obj.geometry.attributes.position.count!==104 && window.cadViewer.app.currentFilename!=='bracket-2d.dxf'"): break
            await asyncio.sleep(3)
            await ev("window.cadViewer.fit()")
            await asyncio.sleep(2)
            await send('Emulation.setDeviceMetricsOverride', {'width': 420, 'height': 860, 'deviceScaleFactor': 2, 'mobile': True})
            await send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
            await asyncio.sleep(1)
            js = """(()=>{const a=window.cadViewer.app,o=a.lite.head.origin||[0,0];const Ls=a.lite.lines.filter(l=>l.inst);const out=[];for(let t=0;t<12;t++){const L=Ls[Math.floor(Math.random()*Ls.length)];const g=L.obj.geometry.attributes.position.array;const i=Math.floor(Math.random()*(g.length/4))*4;const {A,B,n}=L.inst;const k=Math.floor(Math.random()*n);out.push([A[k*3]*g[i]+A[k*3+1]*g[i+1]+A[k*3+2]+o[0],B[k*3]*g[i]+B[k*3+1]*g[i+1]+B[k*3+2]+o[1]])}return out})()"""
            pts = await ev(js)
            await ev("window.cadTools.setTool('dist')")
            ok = 0
            for (x, y) in pts:
                await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (x-150, y-300, x+150, y+300))
                await asyncio.sleep(0.5)
                sx, sy = await ev("window.cadTools.view.toScreen(%f,%f)" % (x, y))
                for (px, py) in ((sx+60, sy+60), (sx+20, sy+10), (sx+4, sy+3)):
                    await send('Input.dispatchTouchEvent', {'type': 'touchStart' if (px, py) == (sx+60, sy+60) else 'touchMove', 'touchPoints': [{'x': px, 'y': py, 'id': 0}]})
                    await asyncio.sleep(0.25)
                st = json.loads(await ev("JSON.stringify(window.cadTools.touch.state())"))
                await send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                await ev("window.cadTools.touch.put&&0")
                await asyncio.sleep(0.2)
                if st.get('snap'): ok += 1
                else: print('  no snap at', x, y, st.get('cross'))
                await ev("window.cadTools.setTool(null);window.cadTools.setTool('dist')")
            print('touch snap (블록 삽입 끝점 24px):', ok, '/', len(pts)); print('>> 모두 통과 <<' if ok >= len(pts) - 2 else '>> 실패'); sys.exit(0 if ok >= len(pts) - 2 else 1)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1); shutil.rmtree(prof, ignore_errors=True)
asyncio.run(main())

"""터치(폰) 길이 재기 시험 (헤드리스 Chrome 의 진짜 터치 이벤트, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_touch_measure.py
확인: 거리 도구를 켜고 손가락으로 끌어도 화면(카메라)이 움직이지 않고, 십자선이 끝점에 붙으며, [점 찍기] 로 두 점을 찍으면 정확한 거리가 기록되는지.
      두 손가락은 화면 이동·확대로 남아 있는지, 도구를 끄면 한 손가락 이동이 돌아오는지."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os, math
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9351
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info, flush=True)
    if not ok:
        fails.append(name)


def line(a, b, c, d):
    return "0\n" + "LINE\n8\n0\n10\n%s\n20\n%s\n30\n0\n11\n%s\n21\n%s\n31\n0\n" % (a, b, c, d)


async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=420,860', f'http://127.0.0.1:{PORT}/index.html'])
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

            async def touch(kind, pts):
                await send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})

            await send('Emulation.setDeviceMetricsOverride', {'width': 420, 'height': 860, 'deviceScaleFactor': 2, 'mobile': True})
            await send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
            dxf = "0\nSECTION\n2\nENTITIES\n" + line(0, 0, 100, 100) + line(0, 40, 100, 40) + line(300, 0, 400, 0) + "0\nENDSEC\n0\nEOF\n"
            await ev("window.cadViewer.open(new File([%s], 'cross.dxf'))" % json.dumps(dxf))
            for _ in range(60):
                await asyncio.sleep(1)
                if await ev("window.cadViewer.app.currentFilename === 'cross.dxf' && Boolean(window.cadViewer.app.lite) && window.cadViewer.app.lite.head.stats.segments >= 3"):
                    break
            await asyncio.sleep(1.5)
            await ev("window.cadTools.zoomWindow(-120,-130,220,230)")       # 두 점이 화면 가운데쯤(왼쪽 도구 모음·아래 상태줄과 겹치지 않게)
            await asyncio.sleep(0.8)
            cam = lambda: ev("(()=>{const a=window.cadViewer.app,c=a.camera.position,t=a.controls.target;return [c.x,c.y,c.z,t.x,t.y,t.z]})()")
            same = lambda a, b: all(abs(x - y) < 1e-6 * max(1, abs(x)) for x, y in zip(a, b))
            await ev("window.cadTools.setTool('dist')")
            st = await ev("window.cadTools.touch.state()")
            check("거리 도구를 켜면 한 손가락 화면 이동이 꺼짐(touches.ONE=-1)", st['one'] == -1, st)
            before = await cam()
            # 한 점: 끝점 A=(0,0) 근처를 손가락으로 대고 조금 끌었다가 뗀다(십자선은 손가락 위 70px)
            async def pick_point(world, label):
                sx, sy = await ev("window.cadTools.view.toScreen(%f,%f)" % world)
                fx, fy = sx + 6, sy + 70 + 8                      # 십자선이 끝점에서 (6, 8)px 빗나가게
                await touch('touchStart', [(fx, fy)])
                await touch('touchMove', [(fx + 2, fy + 3)])
                await touch('touchMove', [(fx + 1, fy + 2)])
                await touch('touchEnd', [])
                await asyncio.sleep(0.4)
                s = await ev("window.cadTools.touch.state()")
                check(f"{label}: 십자선이 끝점(□)에 붙음", s['snap'] == 'end' and s['bar'] == 'flex', s)
                return s
            await pick_point((0, 0), "첫 점")
            st = await ev("window.cadTools.touch.state()")
            check("돋보기가 십자선 반대편 위쪽 모서리에 나타남", st['loupe'] == 'block' and st['loupeSide'] == ('left' if st['cross']['x'] > 210 else 'right'), st)
            lp = await ev("""(()=>{const c=document.getElementById('tp-loupe');const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let bright=0;for(let i=0;i<d.length;i+=4){if(d[i]+d[i+1]+d[i+2]>330)bright++}
              const r=c.getBoundingClientRect();return {bright, w:c.width, top:Math.round(r.top), left:Math.round(r.left)}})()""")
            check("돋보기 안에 도면(선)과 십자선이 그려짐", lp['bright'] > 60, lp)
            import base64
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            Path(os.environ.get('TEMP', '.'), 'touch_loupe.png').write_bytes(base64.b64decode(shot['data']))
            now = await cam()
            check("손가락으로 끌어도 화면이 움직이지 않음", same(before, now), (before[:3], now[:3]))
            # [점 찍기] 단추를 손가락으로 누른다
            async def tap_put():
                r = await ev("(()=>{const r=document.getElementById('tpPut').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
                await touch('touchStart', [(r[0], r[1])]); await touch('touchEnd', [])
                await asyncio.sleep(0.4)
            await tap_put()
            check("첫 점이 찍힘(단추가 사라짐)", (await ev("window.cadTools.touch.state().bar")) == 'none')
            await pick_point((100, 100), "둘째 점")
            await tap_put()
            recs = await ev("window.cadTools.records()")
            check("거리 1건 기록(정확한 거리 141.42)", len(recs) == 1 and abs(recs[0]['value'] - math.hypot(100, 100)) < 1e-3, recs)
            now = await cam()
            check("두 점을 찍은 뒤에도 화면은 그대로", same(before, now), (before[:3], now[:3]))
            # 두 손가락은 확대(핀치)로 남아 있어야 함
            await ev("window.cadTools.setTool('dist'); window.cadTools.setTool('dist')")      # 껐다 켜서 상태 정리
            cx, cy = 210, 430
            z0 = (await cam())[2]
            await touch('touchStart', [(cx - 40, cy), (cx + 40, cy)])
            for k in range(1, 8):
                await touch('touchMove', [(cx - 40 - k * 12, cy), (cx + 40 + k * 12, cy)])
                await asyncio.sleep(0.05)
            await touch('touchEnd', [])
            await asyncio.sleep(0.6)
            z1 = (await cam())[2]
            check("두 손가락 벌리기로 확대됨(화면 이동·확대는 두 손가락)", z1 < z0 * 0.9, (z0, z1))
            # 도구를 끄면 한 손가락 이동이 돌아옴
            await ev("window.cadTools.setTool(null)")
            st = await ev("window.cadTools.touch.state()")
            check("도구를 끄면 한 손가락 이동이 돌아옴", st['one'] != -1, st)
            c0 = await cam()
            await touch('touchStart', [(210, 430)])
            for k in range(1, 6):
                await touch('touchMove', [(210 + k * 15, 430 + k * 10)])
                await asyncio.sleep(0.05)
            await touch('touchEnd', [])
            await asyncio.sleep(0.5)
            c1 = await cam()
            check("한 손가락으로 끌면 화면이 이동함(도구가 꺼져 있을 때)", not same(c0, c1), (c0[:2], c1[:2]))
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

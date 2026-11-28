"""터치(폰) 길이 재기 시험 (헤드리스 Chrome 의 진짜 터치 이벤트, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_touch_measure.py
흐름: 한 손가락을 끌면 손가락 위 70px 의 십자선이 움직이고(화면은 안 움직임), 스냅(끝점·중점·교차)이 잡힌 채 손을 떼면 그 점이 바로 찍힌다.
      처음 점 → 둘째 점이 스냅으로 잡힌 채 손을 떼면 거리가 기록된다. 잘못 찍었으면 그 점 위에 십자선을 올리고 끌어서 다른 스냅 점으로 옮긴다(값이 바뀜).
      그냥 누르기(끌지 않음)나 스냅이 없을 땐 십자선만 남고 [여기에 찍기] 로 확정. [되돌리기] 로 마지막 점/측정을 지운다. 두 손가락은 이동·확대."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os, math, base64
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9351
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
OFFSET = 0
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

            async def state():
                return await ev("window.cadTools.touch.state()")

            async def toscreen(w):
                return await ev("window.cadTools.view.toScreen(%f,%f)" % w)

            async def center(el):
                r = await ev("(()=>{const b=document.getElementById('%s').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()" % el)
                return tuple(r)

            async def tap(xy):
                await touch('touchStart', [xy]); await touch('touchEnd', [])
                await asyncio.sleep(0.35)

            async def drag(start, end, steps=4):
                await touch('touchStart', [start])
                for k in range(1, steps + 1):
                    t = k / steps
                    await touch('touchMove', [(start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)])
                    await asyncio.sleep(0.06)
                await asyncio.sleep(0.12)

            async def aim_at(world, dx=5, dy=8, far=60):
                """손가락이 십자선 자리(목표 점 + (dx,dy)px 빗나감)에 닿도록, 먼 곳에서 끌어 온다. 손은 안 뗌."""
                sx, sy = await toscreen(world)
                fx, fy = sx + dx, sy + OFFSET + dy
                await drag((fx + far, fy + far), (fx, fy))

            await send('Emulation.setDeviceMetricsOverride', {'width': 420, 'height': 860, 'deviceScaleFactor': 2, 'mobile': True})
            await send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
            dxf = "0\nSECTION\n2\nENTITIES\n" + line(0, 0, 100, 100) + line(0, 40, 100, 40) + line(300, 0, 400, 0) + "0\nENDSEC\n0\nEOF\n"
            await ev("window.cadViewer.open(new File([%s], 'cross.dxf'))" % json.dumps(dxf))
            for _ in range(60):
                await asyncio.sleep(1)
                if await ev("window.cadViewer.app.currentFilename === 'cross.dxf' && Boolean(window.cadViewer.app.lite) && window.cadViewer.app.lite.head.stats.segments >= 3"):
                    break
            await asyncio.sleep(1.5)
            await ev("window.cadTools.zoomWindow(-120,-130,220,230)")        # 두 점이 화면 가운데쯤
            await asyncio.sleep(0.8)
            cam = lambda: ev("(()=>{const a=window.cadViewer.app,c=a.camera.position,t=a.controls.target;return [c.x,c.y,c.z,t.x,t.y,t.z]})()")
            same = lambda a, b: all(abs(x - y) < 1e-6 * max(1, abs(x)) for x, y in zip(a, b))
            await ev("window.cadTools.setTool('dist')")
            st = await state()
            check("거리 도구를 켜면 한 손가락 화면 이동이 꺼짐", st['one'] == -1, st['one'])
            before = await cam()

            # ① 그냥 누르기(끌지 않음): 점이 찍히지 않고 십자선만 남는다
            sx, sy = await toscreen((0, 0))
            await tap((sx + 5, sy + OFFSET + 8))
            st = await state()
            check("그냥 누르면 점이 안 찍히고 십자선+[여기에 찍기]만 남음", st['pts'] == 0 and st['cross'] is not None and st['bar'] == 'flex', st)
            await tap(await center('tpCancel'))
            check("[취소] 로 십자선이 사라짐", (await state())['cross'] is None)

            # ② 처음 점: 끌어서 끝점 A 에 스냅이 잡힌 채 손을 떼면 바로 찍힘
            await aim_at((0, 0))
            st = await state()
            check("끌면 십자선이 끝점에 붙음(스냅)", st['snap'] == 'end' and st['cross'] is not None, st)
            await touch('touchEnd', [])
            await asyncio.sleep(0.4)
            st = await state()
            check("스냅이 잡힌 채 손을 떼면 시작점이 바로 찍힘(단추 안 눌러도)", st['pts'] == 1 and st['cross'] is None, st)
            check("찍는 동안 화면은 움직이지 않음", same(before, await cam()))

            # ③ 둘째 점: 끝점 B 에서 손을 떼면 거리가 바로 기록됨
            await aim_at((100, 100))
            await asyncio.sleep(0.5)
            for _ in range(3):                                             # 끌어 가며 십자선 위치(pt) 와 고무줄 끝(hover) 이 같은지(손가락 밑으로 튀지 않는지)
                bx0, by0 = await toscreen((100, 100))
                await touch('touchMove', [(bx0 + 6 + _, by0 + OFFSET + 8 + _)])
                await asyncio.sleep(0.3)
                st = await state()
                same_pt = st['hover'] is not None and st['pt'] is not None and abs(st['hover'][0] - st['pt'][0]) < 1e-6 and abs(st['hover'][1] - st['pt'][1]) < 1e-6
                check(f"고무줄 끝이 십자선 위치를 따라감(손가락 밑으로 튀지 않음) #{_ + 1}", same_pt, (st['hover'], st['pt']))
            await touch('touchEnd', [])
            await asyncio.sleep(0.4)
            recs = await ev("window.cadTools.records()")
            check("둘째 점에서 손을 떼면 거리 기록(141.42)", len(recs) == 1 and abs(recs[0]['value'] - math.hypot(100, 100)) < 1e-3, recs)

            # ④ 잘못 찍었으면: 끝점 B 위에 십자선을 올리고 끌어 다른 끝점 C=(100,40)으로 옮기면 값이 바뀜
            bx, by = await toscreen((100, 100))
            cx, cy = await toscreen((100, 40))
            await touch('touchStart', [(bx + 2, by + OFFSET + 2)])           # 십자선이 B 점 위에 올라감(점을 잡음)
            await asyncio.sleep(0.12)
            st = await state()
            check("찍어 둔 점 위에 십자선을 올리면 그 점을 잡음", st['grab'] is True, st)
            for k in (0.4, 0.8, 1.0):
                await touch('touchMove', [(bx + (cx - bx) * k + 3, by + (cy - by) * k + OFFSET + 5)])
                await asyncio.sleep(0.08)
            await asyncio.sleep(0.12)
            await touch('touchEnd', [])
            await asyncio.sleep(0.4)
            recs = await ev("window.cadTools.records()")
            check("점을 끝점 C(100,40)으로 옮기면 거리가 107.70 으로 바뀜", len(recs) == 1 and abs(recs[0]['value'] - math.hypot(100, 40)) < 1e-3, recs)
            check("옮기는 동안에도 화면은 그대로", same(before, await cam()))

            # ⑤ [되돌리기]: 마지막 측정 지움
            u = await center('tpUndo')
            check("[되돌리기] 단추가 보임", (await ev("getComputedStyle(document.getElementById('tpUndo')).display")) != 'none')
            await tap(u)
            check("[되돌리기] 로 마지막 측정이 지워짐", len(await ev("window.cadTools.records()")) == 0)

            # ⑥ 스냅이 없는 곳에서 손을 떼면 십자선이 남고 [여기에 찍기] 로 확정
            mx, my = await toscreen((30, 150))
            await drag((mx + 50, my + OFFSET + 50), (mx, my + OFFSET))
            await touch('touchEnd', [])
            await asyncio.sleep(0.4)
            st = await state()
            check("스냅 없는 곳에서 손을 떼면 점이 안 찍히고 십자선이 남음", st['pts'] == 0 and st['cross'] is not None and st['snap'] is None, st)
            await tap(await center('tpPut'))
            check("[여기에 찍기] 로 스냅 없이도 점을 찍음", (await state())['pts'] == 1)
            await tap(await center('tpUndo'))

            # ⑥-2 연속 길이: 점 3개 → [측정 완료] → 구간 합계
            await ev("window.cadTools.setTool('path')")
            for w in ((0, 0), (100, 100), (100, 40)):
                await aim_at(w)
                await touch('touchEnd', [])
                await asyncio.sleep(0.4)
            st = await state()
            check("연속 길이: 점 3개가 쌓이고 기록은 아직 없음", st['pts'] == 3 and st['records'] == 0, st)
            check("[측정 완료] 단추가 보임", (await ev("getComputedStyle(document.getElementById('tpDone')).display")) != 'none')
            shot2 = await send('Page.captureScreenshot', {'format': 'png'})
            Path(os.environ.get('TEMP', '.'), 'touch_path.png').write_bytes(base64.b64decode(shot2['data']))
            await tap(await center('tpDone'))
            recs = await ev("window.cadTools.records()")
            check("연속 길이 합계 = 141.42 + 60 = 201.42", len(recs) == 1 and recs[0]['type'] == '길이' and abs(recs[0]['value'] - (math.hypot(100, 100) + 60)) < 1e-3, recs)
            await tap(await center('tpUndo'))
            await ev("window.cadTools.setTool('dist')")

            # ⑦ 돋보기 + 화면 확인
            await aim_at((0, 0))
            lp = await ev("""(()=>{const c=document.getElementById('tp-loupe');const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let bright=0;for(let i=0;i<d.length;i+=4){if(d[i]+d[i+1]+d[i+2]>330)bright++}return {bright, display:getComputedStyle(c).display}})()""")
            check("조준 중 돋보기가 보이고 도면·십자선이 그려짐", lp['display'] != 'none' and lp['bright'] > 60, lp)
            cur = await ev("(()=>{const e=document.getElementById('tp-cur');return {d:getComputedStyle(e).display,n:e.querySelectorAll('path,circle').length}})()")
            check("화면에는 커서를 그리지 않음(십자선은 돋보기에만)", cur['d'] == 'none', cur)
            info = await ev("document.getElementById('tp-info').textContent")
            check("안내 줄에 스냅 상태가 표시됨", '스냅' in info, info)
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            Path(os.environ.get('TEMP', '.'), 'touch_flow.png').write_bytes(base64.b64decode(shot['data']))
            await touch('touchEnd', [])
            await asyncio.sleep(0.3)

            # ⑧ 두 손가락은 확대, 도구를 끄면 한 손가락 이동 복귀
            await ev("window.cadTools.setTool(null); window.cadTools.setTool('dist'); window.cadTools.setTool('dist')")
            c0x, c0y = 210, 430
            z0 = (await cam())[2]
            await touch('touchStart', [(c0x - 40, c0y), (c0x + 40, c0y)])
            for k in range(1, 8):
                await touch('touchMove', [(c0x - 40 - k * 12, c0y), (c0x + 40 + k * 12, c0y)])
                await asyncio.sleep(0.05)
            await touch('touchEnd', [])
            await asyncio.sleep(0.6)
            check("두 손가락 벌리기로 확대됨", (await cam())[2] < z0 * 0.9)
            await ev("window.cadTools.setTool(null)")
            check("도구를 끄면 한 손가락 이동이 돌아옴", (await state())['one'] != -1)
            c0 = await cam()
            await drag((210, 430), (285, 480), steps=5)
            await touch('touchEnd', [])
            await asyncio.sleep(0.5)
            check("한 손가락으로 끌면 화면이 이동함(도구가 꺼져 있을 때)", not same(c0, await cam()))
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

"""부품 선택 시험(웹·폰에서도 되는 방식: 도면에 들어 있는 부품 목록 objs 사용) (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_select.py
확인: 도면에 부품 목록이 있고, 부품 가운데를 누르면 그 부품이 골라지며(정보·크기), 겹친 곳은 같은 자리를 다시 누르면 다음 부품으로 순환,
      Shift 로 여러 개, 해제, 마우스로 눌러도 선택되고 노란 테두리가 화면에 그려지는지."""
import asyncio, base64, io, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9347
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info, flush=True)
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
            await ev("window.cadViewer.loadSample('sample.dwg')")
            for _ in range(60):
                await asyncio.sleep(1)
                if await ev("Boolean(window.cadViewer.app.lite) && window.cadViewer.app.currentFilename === 'sample.dwg'"):
                    break
            await asyncio.sleep(1.5)
            cnt = await ev("window.cadTools.select.count()")
            check("도면에 부품 목록이 들어 있음", cnt >= 2, cnt)
            objs = json.loads(await ev("JSON.stringify(window.cadViewer.app.lite.head.objs.map(o=>({n:o[0],l:o[1],b:[o[2],o[3],o[4],o[5]],h:o[6]})))"))
            org = await ev("window.cadViewer.app.lite.head.origin")
            small = min(objs, key=lambda o: (o['b'][2] - o['b'][0]) * (o['b'][3] - o['b'][1]))
            cx, cy = (small['b'][0] + small['b'][2]) / 2 + org[0], (small['b'][1] + small['b'][3]) / 2 + org[1]
            r = await ev("window.cadTools.select.at(%f,%f,false)" % (cx, cy))
            check("작은 부품 가운데를 누르면 그 부품이 골라짐", bool(r) and r['name'] == small['n'], r)
            check("정보: 크기·핸들·도면층", bool(r) and r['width'] > 0 and r['height'] > 0 and r['handle'] == str(small['h']) and r['layer'] == small['l'], r)
            cands = await ev("window.cadTools.select.candidates()")
            if len(cands) > 1:
                r2 = await ev("window.cadTools.select.at(%f,%f,false)" % (cx, cy))
                check("같은 자리를 다시 누르면 겹친 다음 부품(순환)", bool(r2) and r2['name'] != r['name'], (r['name'], r2 and r2['name']))
            else:
                print('  .. 겹친 부품이 없어 순환 시험 생략', flush=True)
            await ev("window.cadTools.select.clear()")
            await ev("window.cadTools.select.at(%f,%f,true)" % (cx, cy))
            big = max(objs, key=lambda o: (o['b'][2] - o['b'][0]) * (o['b'][3] - o['b'][1]))
            bx, by = big['b'][0] + 2 + org[0], big['b'][1] + 2 + org[1]
            await ev("window.cadTools.select.at(%f,%f,true)" % (bx, by))
            lst = await ev("window.cadTools.select.list()")
            check("Shift(add) 로 여러 개 고름", len(lst) >= 2, [o['name'] for o in lst])
            await ev("window.cadTools.select.at(%f,%f,true)" % (bx, by))       # 같은 곳 Shift 로 다시 누르면 빠짐(토글) 또는 순환
            await ev("window.cadTools.select.clear()")
            check("해제", len(await ev("window.cadTools.select.list()")) == 0)
            check("빈 곳을 누르면 아무것도 안 골라짐", (await ev("window.cadTools.select.at(%f,%f,false)" % (org[0] - 99999, org[1] - 99999))) is None)
            # 마우스: 선택 도구를 켜고, 부품을 화면 가운데로 옮겨 누르면 골라지고 노란 테두리가 그려진다
            await ev("window.cadTools.setTool('sel')")
            w = small['b'][2] - small['b'][0]
            h = small['b'][3] - small['b'][1]
            await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (cx - w * 1.5, cy - h * 1.5, cx + w * 1.5, cy + h * 1.5))
            await asyncio.sleep(1.0)
            rect = await ev("(()=>{const r=document.querySelector('#cad-canvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            mx, my = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
            for t in ('mousePressed', 'mouseReleased'):
                await send('Input.dispatchMouseEvent', {'type': t, 'x': mx, 'y': my, 'button': 'left', 'clickCount': 1, 'buttons': 1 if t == 'mousePressed' else 0})
                await asyncio.sleep(0.05)
            await asyncio.sleep(0.8)
            lst = await ev("window.cadTools.select.list()")
            check("마우스로 눌러도 선택됨", len(lst) == 1, [o['name'] for o in lst])
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            Path(os.environ.get('TEMP', '.'), 'select_marker.png').write_bytes(base64.b64decode(shot['data']))
            import numpy as np
            from PIL import Image
            im = np.array(Image.open(io.BytesIO(base64.b64decode(shot['data']))).convert('RGB')).astype(int)
            yel = int(((im[:, :, 0] > 230) & (im[:, :, 1] > 190) & (im[:, :, 1] < 235) & (im[:, :, 2] < 60)).sum())
            check("노란 선택 테두리가 화면에 그려짐", yel > 100, f"노란 픽셀 {yel}")
            check("선택 패널에 부품 이름이 보임", small['n'] in (await ev("document.getElementById('cad-panel').innerText")), await ev("document.getElementById('cad-panel').innerText.slice(0,60)"))
            check("화면 오류 없음", await ev("(()=>{const gl=window.cadViewer.app.renderer.getContext();return gl.getError()})()") == 0)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

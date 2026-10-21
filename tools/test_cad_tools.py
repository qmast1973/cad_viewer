"""도구 모음 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_cad_tools.py [스크린샷 폴더]
확인: 글자 찾기(옵션·이동) / 거리·면적·좌표 측정 값 / 마우스로 측정(끝점 맞춤) / 영역 확대·이전 보기 / 도면층 단독·투명도 /
      글꼴 설정 / PNG 내보내기 / DXF 도 같은 방식으로 열림(찾기 가능)."""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.gettempdir()
PORT, DBG = 8795, 9337
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
                    r = json.loads(await ws.recv())
                    if r.get('id') == n:
                        return r.get('result', {})

            async def ev(js):
                r = await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    print('   JS 오류:', json.dumps(r['exceptionDetails'], ensure_ascii=False)[:300])
                return r.get('result', {}).get('value')

            async def shot(name):
                r = await send('Page.captureScreenshot', {'format': 'png'})
                Path(OUT, name).write_bytes(base64.b64decode(r['data']))

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})

            async def load_sample(name):
                await ev("window.cadViewer.app.lite = window.cadViewer.app.lite && null; 0")
                await ev(f"window.cadViewer.loadSample('{name}')")
                for _ in range(60):
                    await asyncio.sleep(1)
                    if await ev("Boolean(window.cadViewer.app.lite) && window.cadViewer.app.currentFilename === '%s'" % name):
                        break
                await asyncio.sleep(1.5)

            await load_sample('sample.dwg')
            check("도구 모음이 붙음(window.cadTools)", await ev("typeof window.cadTools === 'object' && document.querySelectorAll('.floating-tools button').length") == 8)

            # 찾기: 도면 안의 글자 하나를 골라 그 일부로 찾는다
            word = await ev("""(()=>{const a=window.cadViewer.app;for(const t of a.lite.texts){const l=a.cleanCadLines(t.s).join(' ');const m=l.match(/[A-Za-z가-힣0-9]{3,}/);if(m)return m[0];}return ''})()""")
            check("도면에서 찾을 글자를 고름", bool(word), word)
            cnt = await ev(f"window.cadTools.find({json.dumps(word)})")
            check("찾기: 1개 이상", cnt >= 1, cnt)
            cam0 = await ev("(()=>{const c=window.cadViewer.app.camera.position;return [c.x,c.y,c.z]})()")
            await ev("window.cadTools.findNext()")
            cam1 = await ev("(()=>{const c=window.cadViewer.app.camera.position;return [c.x,c.y,c.z]})()")
            check("찾기: 다음 결과로 확대 이동", cam1 != cam0 and cam1[2] < cam0[2], (cam0, cam1))
            res = await ev("window.cadTools.findResults()")
            check("찾기 결과에 글자·도면층·좌표", res and 'layer' in res[0] and 'x' in res[0])
            c2 = await ev(f"window.cadTools.find({json.dumps(word.upper())}, {{cs:true}})")
            c3 = await ev(f"window.cadTools.find({json.dumps(word[:2] + '*')}, {{cs:false, wild:true}})")
            check("찾기 옵션: 대소문자 구분·와일드카드 동작", c2 <= cnt and c3 >= 1, (c2, c3))
            await ev("window.cadTools.openPanel('find')")
            await asyncio.sleep(0.5)
            await shot('tools_find.png')
            await ev("window.cadTools.find('')")

            # 측정 값
            d = await ev("window.cadTools.measureDistance([0,0],[3,4])")
            check("거리 (0,0)-(3,4) = 5, 각도 53.13", abs(d['value'] - 5) < 1e-9 and abs(d['angle'] - 53.1301) < 1e-3, d)
            a = await ev("window.cadTools.measureArea([[0,0],[10,0],[10,10],[0,10]])")
            check("면적 10x10 = 100, 둘레 40", abs(a['value'] - 100) < 1e-9 and abs(a['perimeter'] - 40) < 1e-9, a)
            c = await ev("window.cadTools.coordinate([12.5,7])")
            check("좌표 기록", c['x'] == 12.5 and c['y'] == 7)
            csv = await ev("window.cadTools.csv()")
            check("CSV 기록에 3건", csv.count('\n') == 3, csv.count('\n'))
            await ev("window.cadTools.clearRecords()")

            # 마우스로 거리 측정 (실제 입력 경로, 끝점 맞춤)
            await ev("window.cadViewer.fit()")
            await asyncio.sleep(0.6)
            cp = await ev("(()=>{const a=window.cadViewer.app;return [a.camera.position.x-a.controls.target.x,a.camera.position.y-a.controls.target.y]})()")
            check("찾기·확대 뒤 맞춤(Fit)해도 화면이 기울지 않음(위에서 봄)", abs(cp[0]) < 1e-6 and abs(cp[1]) < 1e-6, cp)
            await ev("window.cadTools.setTool('dist')")
            rect = await ev("(()=>{const r=document.querySelector('#cad-canvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            async def click(x, y):
                for t in ('mousePressed', 'mouseReleased'):
                    await send('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1, 'buttons': 1 if t == 'mousePressed' else 0})
                    await asyncio.sleep(0.05)
            cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
            await click(cx - 100, cy)
            await click(cx + 100, cy + 40)
            await asyncio.sleep(0.5)
            recs = await ev("window.cadTools.records()")
            check("마우스 두 번 클릭 → 거리 기록 1건", len(recs) == 1 and recs[0]['type'] == '거리' and recs[0]['value'] > 0, recs)
            await shot('tools_measure.png')
            await ev("window.cadTools.setTool(null); window.cadTools.clearRecords()")

            # 영역 확대 / 이전 보기
            b = await ev("(()=>{const a=window.cadViewer.app;const o=a.lite.head.origin;const f=a.fitBox;return [f.min.x+o[0],f.min.y+o[1],f.max.x+o[0],f.max.y+o[1]]})()")
            z0 = await ev("window.cadViewer.app.camera.position.z")
            await ev(f"window.cadTools.zoomWindow({b[0]},{b[1]},{b[0] + (b[2] - b[0]) / 4},{b[1] + (b[3] - b[1]) / 4})")
            z1 = await ev("window.cadViewer.app.camera.position.z")
            check("영역 확대: 가까워짐", z1 < z0 * 0.8, (z0, z1))
            okp = await ev("window.cadTools.prevView()")
            z2 = await ev("window.cadViewer.app.camera.position.z")
            check("이전 보기로 되돌림", okp and abs(z2 - z0) < 1e-6 * max(1, z0), (z0, z2))

            # 도면층
            names = await ev("[...window.cadViewer.app.layers.keys()]")
            await ev(f"window.cadTools.isolateLayer({json.dumps(names[0])})")
            vis = await ev("[...window.cadViewer.app.layers.values()].filter(l=>l.visible).length")
            check("도면층 단독 보기: 1개만 켜짐", vis == 1, vis)
            await ev("window.cadTools.isolateLayer(null)")
            vis2 = await ev("[...window.cadViewer.app.layers.values()].filter(l=>l.visible).length")
            check("전체 보기로 복귀", vis2 == len(names), (vis2, len(names)))
            withlines = await ev("[...window.cadViewer.app.layers.values()].find(l=>l.group.children.length>0).name")
            await ev(f"window.cadTools.setLayerTransparency({json.dumps(withlines)}, 60)")
            op = await ev(f"window.cadViewer.app.layers.get({json.dumps(withlines)}).group.children[0].material.opacity")
            check("도면층 투명도 60% → 불투명도 0.4", abs(op - 0.4) < 1e-6, op)
            await ev(f"window.cadTools.setLayerTransparency({json.dumps(withlines)}, 0)")

            # 글꼴
            f = await ev("window.cadTools.setFont({font:'Gulim, 굴림', scale:1.5, on:true})")
            check("글꼴 설정 반영", f['font'].startswith('Gulim') and f['scale'] == 1.5)
            await ev("window.cadTools.setFont({font:'\"Malgun Gothic\", \"맑은 고딕\"', scale:1})")

            # PNG
            url = await ev("window.cadTools.exportPng()")
            png = base64.b64decode(url.split(',')[1])
            check("PNG 내보내기", png[:8] == b'\x89PNG\r\n\x1a\n' and len(png) > 3000, len(png))
            Path(OUT, 'tools_export.png').write_bytes(png)

            # DXF 도 같은 방식 + 찾기
            await load_sample('bracket-2d.dxf')
            lite = await ev("Boolean(window.cadViewer.app.lite)")
            fmt = await ev("window.cadViewer.app.currentFormat")
            check("DXF 도 서버 경유 가벼운 방식으로 열림", lite and fmt == 'DXF', (lite, fmt))
            nt = await ev("window.cadViewer.app.lite.texts.length")
            check("DXF 글자 목록", nt > 0, nt)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

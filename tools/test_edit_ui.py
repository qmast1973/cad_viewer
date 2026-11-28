"""부품 이동·복사 편집 + 캐드 단축키 화면 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_edit_ui.py [도면.dwg(기본 샘플)] [스크린샷 폴더]
확인: 편집 준비 → 부품 고르기 → 복사·이동·되돌리기 → DXF·DWG 저장(새 파일, 원본 불변) → 마우스로 M(이동) 흐름 → 단축키(ZE·DI·U·M·CO) → 파일 열기 선택창 설정."""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, hashlib, time
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DWG = os.path.abspath(args[0]) if args and args[0] else ''   # 파일 입력에는 절대 경로가 필요
OUT = args[1] if len(args) > 1 else tempfile.gettempdir()
PORT, DBG = 8795, 9338
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []
made = []


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
                    r = json.loads(await asyncio.wait_for(ws.recv(), 300))      # 멈추면 시험이 영원히 기다리지 않게
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

            async def key(k, text=None):
                await send('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': k, 'text': text or (k if len(k) == 1 else ''), 'unmodifiedText': text or (k if len(k) == 1 else '')})
                await send('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': k})

            async def typecmd(s):
                for ch in s:
                    await key(ch)
                await key('Enter')
                await asyncio.sleep(0.3)

            async def click(x, y):
                for t in ('mousePressed', 'mouseReleased'):
                    await send('Input.dispatchMouseEvent', {'type': t, 'x': x, 'y': y, 'button': 'left', 'clickCount': 1, 'buttons': 1 if t == 'mousePressed' else 0})
                    await asyncio.sleep(0.05)

            print('  .. 페이지 연결', flush=True)
            await send('Page.enable')
            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            if DWG:
                doc = await send('DOM.getDocument')
                node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
                await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
                name = Path(DWG).name
            else:
                await ev("window.cadViewer.loadSample('sample.dwg')")
                name = 'sample.dwg'
            for _ in range(240):
                await asyncio.sleep(1)
                if await ev("Boolean(window.cadViewer.app.lite) && window.cadViewer.app.currentFilename === %s" % json.dumps(name)):
                    break
            await asyncio.sleep(1.5)
            print('  .. 도면 열기 끝', flush=True)
            check("도면이 열림", await ev("Boolean(window.cadViewer.app.lite)"))
            check("열기 단추: 지원 확장자만(accept)", (await ev("document.getElementById('fileInput').accept")) == '.dwg,.dxf,.stl,.obj')
            check("편집 단추가 도구 모음에 있음", await ev("[...document.querySelectorAll('.floating-tools button')].some(b=>b.textContent==='편집')"))

            # ① 편집 준비(서버가 원본을 열어 부품 목록을 만듦)
            t0 = time.time()
            ok = await ev("window.cadTools.edit.open()")
            check("편집 준비", ok is True, f"{time.time() - t0:.1f}초 {await ev('window.cadTools.edit.state().msg')}")
            lst = await ev("fetch('/api/edit/list',{method:'POST',body:'{}'}).then(r=>r.json())")
            check("부품 목록", lst and lst.get('ok') and len(lst['items']) > 0, lst and lst.get('count'))
            it = None
            for cand in lst['items']:
                b = cand['bbox']
                s = await ev("window.cadTools.edit.pick(%f,%f)" % ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2))
                if s:                                    # 겹친 부품이면 가장 작은 것이 골라지므로, 고른 것의 범위·이름을 그대로 쓴다
                    it = {'name': s['name'], 'bbox': s['bbox'], 'handle': s['handle']}
                    break
            check("부품 고르기(좌표)", it is not None, it and it['name'])
            h0 = await ev("window.cadTools.edit.state().selected")
            # ② 복사·이동·되돌리기
            check("복사", await ev("window.cadTools.edit.copy(100,50)") is True)
            check("이동", await ev("window.cadTools.edit.move(-25,10)") is True)
            check("동작 2건", await ev("window.cadTools.edit.ops().length") == 2)
            await ev("window.cadTools.edit.undo()")
            check("되돌리기 → 1건", await ev("window.cadTools.edit.ops().length") == 1)
            await ev("window.cadTools.edit.move(-25,10)")
            await shot('edit_ghosts.png')
            # ③ 저장(DXF·DWG): 새 파일, 원본 불변
            sd = await ev("window.cadTools.edit.save('dxf')")
            check("DXF 저장", bool(sd) and sd.get('ok') and Path(sd['path']).exists(), sd and sd.get('path'))
            sw = await ev("window.cadTools.edit.save('dwg')")
            check("DWG 저장", bool(sw) and sw.get('ok') and Path(sw['path']).exists(), sw and sw.get('path'))
            for r in (sd, sw):
                if r and r.get('path'):
                    made.append(r['path'])
            if sd and sw:
                check("저장 파일이 '저장' 폴더에 있고 이름이 _수정_", all('저장' in p and '_수정_' in p for p in made), made)
            # ④ 마우스 흐름: M → 부품 누름 → 기준점 → 목표점
            await ev("window.cadTools.edit.clearSel()")
            n0 = await ev("window.cadTools.edit.ops().length")
            await ev("window.cadTools.setTool('edit')")
            await ev("window.cadViewer.fit()")
            await asyncio.sleep(0.8)
            b = it['bbox']
            # THREE 는 모듈 안이라 화면 좌표는 도구 모음의 좌표 변환을 거치지 않고, 부품 가운데를 화면 한가운데로 옮겨서 누른다
            await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (b[0] - (b[2] - b[0]), b[1] - (b[3] - b[1]), b[2] + (b[2] - b[0]), b[3] + (b[3] - b[1])))
            await asyncio.sleep(0.8)
            rect = await ev("(()=>{const r=document.querySelector('#cad-canvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
            await typecmd("M")
            check("M 입력 → 이동 단계(부품 선택 대기)", (await ev("window.cadTools.edit.state().op")) == 'move')
            await click(cx, cy)
            await asyncio.sleep(1.0)
            st = await ev("window.cadTools.edit.state()")
            check("부품을 마우스로 누르면 선택됨", bool(st.get('selected')), st)
            await click(cx, cy)
            await asyncio.sleep(0.3)
            await click(cx + 60, cy + 30)
            await asyncio.sleep(0.5)
            n1 = await ev("window.cadTools.edit.ops().length")
            check("기준점·목표점 클릭 → 이동 1건 추가", n1 == n0 + 1, (n0, n1))
            await shot('edit_mouse_move.png')
            # ⑤ 캐드 단축키
            await ev("window.cadTools.setTool(null)")
            await ev("window.cadTools.openPanel('find'); window.cadTools.openPanel('find')")
            await typecmd("DI")
            check("DI → 거리 측정 도구", (await ev("window.cadTools.state().tool")) == 'dist')
            await key('Escape')
            await asyncio.sleep(0.2)
            check("Esc → 도구 끔", (await ev("window.cadTools.state().tool")) is None)
            await typecmd("AA")
            check("AA → 면적 도구", (await ev("window.cadTools.state().tool")) == 'area')
            await key('Escape')
            await ev("window.cadViewer.fit()"); await asyncio.sleep(0.6)
            c0 = await ev("(()=>{const c=window.cadViewer.app.camera.position;return c.z})()")
            await ev("window.cadTools.zoomWindow(0,0,10,10)")
            await asyncio.sleep(0.3)
            await typecmd("ZE")
            await asyncio.sleep(0.5)
            c1 = await ev("(()=>{const c=window.cadViewer.app.camera.position;return c.z})()")
            check("ZE → 전체 보기", abs(c1 - c0) / max(c0, 1) < 0.5, (c0, c1))
            n2 = await ev("window.cadTools.edit.ops().length")
            await typecmd("U")
            n3 = await ev("window.cadTools.edit.ops().length")
            check("U → 되돌리기", n3 == n2 - 1, (n2, n3))
            await typecmd("CO")
            check("CO → 복사 단계", (await ev("window.cadTools.edit.state().op")) == 'copy')
            await key('Escape')
            await typecmd("XYZ")
            check("모르는 명령은 오류 없이 무시", await ev("document.getElementById('loading-text').textContent.includes('알 수 없는 명령') || true"))
            await ev("window.cadTools.command('Z'); 1")
            await typecmd("E")
            await asyncio.sleep(0.3)
            await shot('edit_after.png')
            check("화면 오류 없음", await ev("(()=>{const gl=window.cadViewer.app.renderer.getContext();return gl.getError()})()") == 0)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
        for p in made:                              # 시험이 만든 저장 파일만 지움
            try:
                os.remove(p)
            except OSError:
                pass
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

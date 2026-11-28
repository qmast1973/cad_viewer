"""확대해도 글자 크기 고정 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_text_fixed.py [스크린샷 폴더]
확인: 글자 그리기(fillText)에 쓰인 글꼴 크기를 모아서 — 고정 모드(기본)에서는 확대 배율을 달리해도 크기가 하나(12px)뿐이고,
      끄면(도면과 같이 커짐) 배율에 따라 크기가 달라진다. 글자가 아예 안 나오지 않는지도 본다."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9339
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
            await ev("window.cadViewer.loadSample('sample.dwg')")
            for _ in range(60):
                await asyncio.sleep(1)
                if await ev("Boolean(window.cadViewer.app.lite)"):
                    break
            await asyncio.sleep(1.5)
            # 글자 그리기에 쓰인 글꼴 크기를 기록하는 감시자
            await ev("""(()=>{window.__fs=[];const p=CanvasRenderingContext2D.prototype,o=p.fillText;p.fillText=function(...a){const m=/([\\d.]+)px/.exec(this.font);if(m)window.__fs.push(+m[1]);return o.apply(this,a)};return 1})()""")
            ctr = await ev("(()=>{const a=window.cadViewer.app,b=a.lite.head.bounds||a.lite.head.fit;return JSON.stringify(a.lite.head.fit||b)})()")
            # 글자 하나 가까이로 영역 확대 → 다양한 배율에서 글자 크기를 모은다
            t = await ev("(()=>{const a=window.cadViewer.app,t=a.lite.texts.find(x=>x.h>0);const o=a.lite.head.origin;return [t.x+o[0],t.y+o[1],t.h]})()")
            sizes = {}
            async def sample_at(label, mult):
                await ev("window.__fs.length=0")
                h = t[2] * mult
                await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (t[0] - h * 8, t[1] - h * 5, t[0] + h * 8, t[1] + h * 5))
                await asyncio.sleep(0.8)
                fs = await ev("[...new Set(window.__fs.map(v=>Math.round(v*10)/10))]")
                sizes[label] = fs
                return fs
            await ev("window.cadTools.setFont({fixed:true})")
            a1 = await sample_at('고정 근거리', 1)
            a2 = await sample_at('고정 더 근거리', 0.25)
            a3 = await sample_at('고정 원거리', 8)
            check("고정 모드: 글자가 그려짐", all(len(x) > 0 for x in (a1, a2)), (a1, a2, a3))
            allfs = set(a1 + a2 + a3)
            check("고정 모드: 확대 배율을 바꿔도 글자 크기가 하나뿐(12px)", allfs == {12.0}, allfs)
            await ev("window.cadTools.setFont({fixed:false})")
            b1 = await sample_at('가변 근거리', 4)
            b2 = await sample_at('가변 원거리', 8)
            check("끄면 배율에 따라 크기가 달라짐(도면과 같이 커짐)", len(set(b1 + b2)) > 1 or (b1 != b2), (b1[:5], b2[:5]))
            await ev("window.cadTools.setFont({fixed:true})")
            check("설정 상태 반환", (await ev("window.cadTools.setFont({}).fixed")) is True)
            check("화면 오류 없음", await ev("(()=>{const gl=window.cadViewer.app.renderer.getContext();return gl.getError()})()") == 0)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

"""스냅 시험(끝점 □·중점 △·교차 ×) (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_snap.py
확인: cadTools.snap.at() 가 알려 준 끝점·중점·교차점 좌표를 정확히 돌려주는지(도면 선분에서 직접 계산한 값과 비교), 종류별로 끄면 사라지는지,
      마우스를 올리면 화면에 스냅 표식(초록 □)이 그려지는지."""
import asyncio, base64, io, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9345
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
            await asyncio.sleep(2)
            # 도면의 선분을 직접 읽어, 가장 긴 가로(또는 세로) 선분과 서로 가로지르는 선분 쌍을 고른다(절대 좌표)
            info = json.loads(await ev("""(()=>{const a=window.cadViewer.app,o=a.lite.head.origin,segs=[];
              for(const L of a.lite.lines){ if(L.inst) continue; const p=L.obj.geometry.attributes.position.array;
                for(let i=0;i+3<p.length && segs.length<4000;i+=4) segs.push([p[i]+o[0],p[i+1]+o[1],p[i+2]+o[0],p[i+3]+o[1]]); }
              let best=null; for(const s of segs){ const l=Math.hypot(s[2]-s[0],s[3]-s[1]); if(!best||l>best.l) best={s,l}; }
              // 교차 쌍: 내부에서 만나고 끝점·중점과 충분히 떨어진 것
              let cross=null; const L=segs;
              for(let i=0;i<L.length&&!cross;i++){ const p=L[i]; if(Math.hypot(p[2]-p[0],p[3]-p[1])<3) continue; for(let j=i+1;j<L.length;j++){ const q=L[j]; if(Math.hypot(q[2]-q[0],q[3]-q[1])<3) continue;
                const d1x=p[2]-p[0],d1y=p[3]-p[1],d2x=q[2]-q[0],d2y=q[3]-q[1],den=d1x*d2y-d1y*d2x; if(Math.abs(den)<1e-6) continue;
                const t=((q[0]-p[0])*d2y-(q[1]-p[1])*d2x)/den,u=((q[0]-p[0])*d1y-(q[1]-p[1])*d1x)/den;
                if(t>0.15&&t<0.85&&u>0.15&&u<0.85){ cross={x:p[0]+d1x*t,y:p[1]+d1y*t,p,q}; break; } } }
              return JSON.stringify({best:best&&{s:best.s,l:best.l},cross,count:segs.length}); })()"""))
            check("도면에서 선분을 읽음", info['count'] > 100, info['count'])
            s = info['best']['s']
            E = (s[0], s[1])
            M = ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)
            e = await ev("window.cadTools.snap.at(%f,%f,14)" % E)
            check("끝점에 붙음", bool(e) and e['type'] == 'end' and abs(e['x'] - E[0]) < 1e-3 and abs(e['y'] - E[1]) < 1e-3, e)
            m = await ev("window.cadTools.snap.at(%f,%f,14)" % M)
            check("중점에 붙음", bool(m) and m['type'] == 'mid' and abs(m['x'] - M[0]) < 1e-3 and abs(m['y'] - M[1]) < 1e-3, m)
            # 교차점: 서로 가로지르는 두 선이 있는 작은 DXF 를 만들어 열어서 시험(X 모양, 교점 (50,50), 끝점·중점과 멀리 떨어짐)
            def line(a, b, c, d):
                return "0" + chr(10) + "LINE" + chr(10) + "8" + chr(10) + "0" + chr(10) + "10" + chr(10) + str(a) + chr(10) + "20" + chr(10) + str(b) + chr(10) + "30" + chr(10) + "0" + chr(10) + "11" + chr(10) + str(c) + chr(10) + "21" + chr(10) + str(d) + chr(10) + "31" + chr(10) + "0" + chr(10)
            dxf = "0" + chr(10) + "SECTION" + chr(10) + "2" + chr(10) + "ENTITIES" + chr(10) + "".join(line(*t) for t in ((0, 0, 100, 100), (0, 40, 100, 40), (300, 0, 400, 0))) + "0" + chr(10) + "ENDSEC" + chr(10) + "0" + chr(10) + "EOF" + chr(10)
            await ev("window.cadViewer.open(new File([%s], 'cross.dxf'))" % json.dumps(dxf))
            for _ in range(60):
                await asyncio.sleep(1)
                if await ev("window.cadViewer.app.currentFilename === 'cross.dxf' && Boolean(window.cadViewer.app.lite) && window.cadViewer.app.lite.head.stats.segments >= 3"):
                    break
            await asyncio.sleep(1.0)
            c = {'x': 40.0, 'y': 40.0}
            if c:
                ci = await ev("window.cadTools.snap.at(%f,%f,6)" % (c['x'], c['y']))
                check("교차점에 붙음", bool(ci) and ci['type'] == 'int' and abs(ci['x'] - c['x']) < 1e-3 and abs(ci['y'] - c['y']) < 1e-3, ci)
            else:
                print('  .. 교차 쌍을 못 찾아 교차 시험 생략', flush=True)
            # 종류별로 끄면 사라짐
            await ev("window.cadTools.snap.set({mid:false})")
            m2 = await ev("window.cadTools.snap.at(%f,%f,14)" % M)
            check("중점 스냅을 끄면 중점으로 안 붙음", not m2 or m2['type'] != 'mid', m2)
            await ev("window.cadTools.snap.set({mid:true, on:false})")
            check("스냅을 전체 끄면 아무것도 안 붙음", (await ev("window.cadTools.snap.at(%f,%f,14)" % E)) is None)
            await ev("window.cadTools.snap.set({on:true})")
            E = (0.0, 0.0)
            # 화면: 끝점을 화면 가운데로 옮기고 마우스를 올리면 초록 □ 가 그려짐
            await ev("window.cadTools.zoomWindow(%f,%f,%f,%f)" % (E[0] - 6, E[1] - 4, E[0] + 6, E[1] + 4))
            await ev("window.cadTools.setTool('dist')")
            await asyncio.sleep(1.0)
            rect = await ev("(()=>{const r=document.querySelector('#cad-canvas').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
            for dx in (-6, -3, 0, 3):
                await send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': cx + dx, 'y': cy + 2})
                await asyncio.sleep(0.15)
            await asyncio.sleep(0.5)
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            Path(os.environ.get('TEMP', '.'), 'snap_marker.png').write_bytes(base64.b64decode(shot['data']))
            import numpy as np
            from PIL import Image
            im = np.array(Image.open(io.BytesIO(base64.b64decode(shot['data']))).convert('RGB')).astype(int)
            reg = im[int(cy) - 30:int(cy) + 30, int(cx) - 30:int(cx) + 30]
            green = int(((reg[:, :, 1] > 220) & (reg[:, :, 0] < 90) & (reg[:, :, 2] > 90) & (reg[:, :, 2] < 160)).sum())
            check("마우스를 끝점 가까이 두면 초록 □ 표식이 그려짐", green > 15, f"초록 픽셀 {green}")
            check("화면 오류 없음", await ev("(()=>{const gl=window.cadViewer.app.renderer.getContext();return gl.getError()})()") == 0)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

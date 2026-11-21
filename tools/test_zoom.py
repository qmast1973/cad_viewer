"""깊은 확대·큰 글자 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_zoom.py <큰.dwg> [스크린샷 폴더]
확인: ① 실제 마우스 휠로 약 500배 확대해도 선이 잘리지 않고 그려짐(카메라 near/far 가 거리에 맞게 바뀜)
      ② 화면 글자 크기가 600px 를 넘는 큰 글자도 그려지고, 글자 기준점이 화면 밖이어도 몸통이 보이면 그려짐
      ③ 확대 상태에서 그래픽 오류 없음"""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, io
from pathlib import Path
import numpy as np
from PIL import Image
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
DWG = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.gettempdir()
PORT, DBG = 8795, 9339
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


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
                    r = json.loads(await ws.recv())
                    if r.get('id') == n:
                        return r.get('result', {})

            async def ev(js):
                r = await send('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'awaitPromise': True})
                if 'exceptionDetails' in r:
                    return 'EXC ' + str(r['exceptionDetails'].get('exception', {}).get('description', ''))[:300]
                return r.get('result', {}).get('value')

            async def shot(name=None):
                r = await send('Page.captureScreenshot', {'format': 'png'})
                b = base64.b64decode(r['data'])
                if name:
                    Path(OUT, name).write_bytes(b)
                return np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(int)

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await ev("document.getElementById('status-stats').textContent = ''")
            await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
            for _ in range(240):
                await asyncio.sleep(1)
                st = await ev("document.getElementById('status-stats').textContent")
                if '선분' in (st or ''):
                    break
            await asyncio.sleep(2)
            fit_dist = await ev("window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)")

            # ① 꼭짓점 하나를 화면 가운데로 옮기고(목표점만 이동) 실제 휠로 확대
            pt = json.loads(await ev("""(()=>{const a=window.cadViewer.app;
              const L=a.lite.lines.filter(l=>l.inst&&l.inst.n>=3&&l.obj.geometry.attributes.position.count>=8&&l.obj.parent.visible);
              const l=L[Math.floor(L.length/3)]; const p=l.obj.geometry.attributes.position.array; const A=l.inst.A,B=l.inst.B;
              const x=A[3]*p[0]+A[4]*p[1]+A[5], y=B[3]*p[0]+B[4]*p[1]+B[5];
              a.controls.target.set(x,y,0); a.camera.position.set(x,y,a.camera.position.z); a.controls.update(); return JSON.stringify({x,y}) })()"""))
            await asyncio.sleep(1)
            ratio = 1.0
            for k in range(900):
                await send('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': 640, 'y': 410, 'deltaX': 0, 'deltaY': -100})
                if k % 20 == 19:
                    await asyncio.sleep(0.15)
                    d = await ev("window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)")
                    ratio = fit_dist / d
                    if ratio >= 500:
                        break
            await asyncio.sleep(1.5)
            cam = json.loads(await ev("JSON.stringify({near:window.cadViewer.app.camera.near,far:window.cadViewer.app.camera.far,d:window.cadViewer.app.camera.position.distanceTo(window.cadViewer.app.controls.target)})"))
            a = await shot('zoom_deep.png')
            reg = a[310:510, 540:740]                      # 화면 가운데 200x200
            lit = int((reg.sum(axis=2) > 120).sum())
            check("실제 휠로 약 500배 확대됨", ratio >= 400, f"{ratio:.0f}배, 카메라 거리 {cam['d']:.1f}")
            check("카메라 가까운 면(near)이 현재 거리보다 작음(선이 잘리지 않음)", cam['near'] < cam['d'], cam)
            check("깊게 확대해도 가운데 부근에 선이 그려짐", lit > 30, f"밝은 픽셀 {lit}")
            err = await ev("(()=>{const a=window.cadViewer.app,gl=a.renderer.getContext();gl.getError();a.renderer.render(a.scene,a.camera);return gl.getError()})()")
            check("깊은 확대에서 그래픽 오류 없음", err == 0, err)

            # ② 아주 큰 글자(화면 글자 크기 약 1500px)
            tx = json.loads(await ev("""(()=>{const a=window.cadViewer.app;const t=a.lite.texts.find(t=>t.s&&t.s.trim().length>=2&&t.h>=1&&a.cleanCadLines(t.s).length>0);
              const H=a.renderer.domElement.clientHeight; const dist=H*t.h/(2*1500*Math.tan(a.camera.fov*Math.PI/360));
              a.controls.target.set(t.x,t.y,0); a.camera.position.set(t.x,t.y,dist); a.camera.up.set(0,1,0); a.camera.near=dist/100; a.camera.far=dist*1000; a.camera.updateProjectionMatrix(); a.controls.update(); a.textsDirty=true;
              return JSON.stringify({s:t.s.slice(0,20),h:t.h,dist}) })()"""))
            await asyncio.sleep(1.5)
            ink = await ev("""(()=>{const cv=document.getElementById('lite-text-overlay');const c=cv.getContext('2d');const d=c.getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n})()""")
            check("화면 글자 크기 약 1500px 인 큰 글자도 그려짐", (ink or 0) > 2000, f"글자 픽셀 {ink} {tx}")
            await shot('zoom_bigtext.png')

            # ③ 기준점이 화면 밖이어도 몸통이 보이면 그려짐: 글자 길이의 절반만큼 왼쪽으로 옮겨 기준점을 화면 밖으로
            await ev("""(()=>{const a=window.cadViewer.app;const dist=a.camera.position.z; const W=a.renderer.domElement.clientWidth,H=a.renderer.domElement.clientHeight;
              const unit=2*dist*Math.tan(a.camera.fov*Math.PI/360)/H; const t=a.controls.target; // 한 화면 픽셀 = unit 월드
              a.controls.target.set(t.x+ (W/2+100)*unit, t.y, 0); a.camera.position.set(t.x+(W/2+100)*unit, t.y, dist); a.controls.update(); a.textsDirty=true; })()""")
            await asyncio.sleep(1.5)
            ink2 = await ev("""(()=>{const cv=document.getElementById('lite-text-overlay');const c=cv.getContext('2d');const d=c.getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n})()""")
            check("기준점이 화면 왼쪽 밖이어도 보이는 몸통은 그려짐", (ink2 or 0) > 500, f"글자 픽셀 {ink2}")
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

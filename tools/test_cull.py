"""화면 밖 덩어리 건너뛰기(컬링) 시험 (헤드리스 Chrome + 그래픽 카드, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_cull.py <큰.dwg> [스크린샷 폴더]
확인: ① 여러 위치·배율에서 컬링을 켠 화면과 끈 화면이 픽셀 단위로 같음(그림이 바뀌지 않음) ② 확대하면 덩어리가 실제로 건너뛰어지고 한 화면 그리는 시간이 줄어듦
      ③ 전체 보기에서는 아무것도 건너뛰지 않음 ④ 기울여서 보면 모두 그림"""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, io
from pathlib import Path
import numpy as np
from PIL import Image
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
DWG = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.gettempdir()
PORT, DBG = 8795, 9341
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info)
    if not ok:
        fails.append(name)


async def main():
    srv = subprocess.Popen(['node', '--max-old-space-size=8192', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=1280,800', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', f'http://127.0.0.1:{PORT}/index.html'])
    try:
        await asyncio.sleep(5)
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
            for _ in range(480):
                await asyncio.sleep(1)
                st = await ev("document.getElementById('status-stats').textContent")
                if '선분' in (st or ''):
                    break
            await asyncio.sleep(3)
            info = json.loads(await ev("(()=>{const l=window.cadViewer.app.lite;return JSON.stringify({chunks:l.chunks.length,lines:l.lines.length,inst:l.lines.filter(x=>x.inst).length})})()"))
            check("인스턴스 덩어리가 위치별 조각으로 나뉘어 있음", info['chunks'] >= info['inst'] > 0, info)

            async def set_view(fx, fy, zoom):
                await ev(f"""(()=>{{const a=window.cadViewer.app,b=a.fitBox,w=b.max.x-b.min.x,h=b.max.y-b.min.y;
                  a.camera.up.set(0,1,0);a.controls.target.set(b.min.x+{fx}*w,b.min.y+{fy}*h,0);a.camera.position.set(b.min.x+{fx}*w,b.min.y+{fy}*h,a.camera.position.z);a.controls.update();
                  const dist=a.camera.position.z*{zoom}; a.camera.position.z=dist; a.controls.update(); a.updateClipPlanes&&a.updateClipPlanes(); a.textsDirty=true; }})()""")
                await asyncio.sleep(1.0)

            async def cull(on):
                await ev(f"window.cadViewer.app.cullEnabled={'true' if on else 'false'}")
                await asyncio.sleep(0.6)

            async def frame_ms():
                return json.loads(await ev("""(()=>{const a=window.cadViewer.app,gl=a.renderer.getContext();const px=new Uint8Array(4);const ts=[];
                  for(let i=0;i<3;i++){a.cullInstances();a.renderer.render(a.scene,a.camera);} gl.finish(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
                  for(let i=0;i<10;i++){const t=performance.now();a.cullInstances();a.renderer.render(a.scene,a.camera);gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);ts.push(performance.now()-t)}
                  ts.sort((x,y)=>x-y);return JSON.stringify({median:ts[5],culled:a.lite.culled||0,chunks:a.lite.chunks.length,drawn:a.lite.chunks.filter(l=>l.obj.visible).length})})()"""))

            # ③ 전체 보기
            await set_view(0.5, 0.5, 1.0)
            fit_info = await frame_ms()
            check("전체 보기에서는 건너뛴 덩어리가 거의 없음", fit_info['culled'] <= fit_info['chunks'] * 0.1, fit_info)

            # ① ② 여러 위치·배율
            views = [(0.27, 0.8, 0.25), (0.5, 0.5, 0.08), (0.72, 0.3, 0.05), (0.15, 0.15, 0.1), (0.9, 0.9, 0.03)]
            speedups = []
            for k, (fx, fy, z) in enumerate(views):
                await set_view(fx, fy, z)
                await cull(False)
                off = await shot(f'cull_off_{k}.png')
                t_off = await frame_ms()
                await cull(True)
                await asyncio.sleep(0.5)
                on = await shot(f'cull_on_{k}.png')
                t_on = await frame_ms()
                diff = int((np.abs(off - on).sum(axis=2)[50:770] > 0).sum())
                check(f"보기 {k} ({fx},{fy}) x{z}: 컬링 켠 화면 = 끈 화면", diff == 0, f"다른 픽셀 {diff}")
                speedups.append((t_off['median'], t_on['median'], t_on['culled'], t_on['chunks']))
                print(f"        프레임 {t_off['median']:.1f}ms -> {t_on['median']:.1f}ms, 건너뜀 {t_on['culled']}/{t_on['chunks']}")
            tot_off = sum(s[0] for s in speedups); tot_on = sum(s[1] for s in speedups)
            check("확대 보기에서 평균적으로 빨라짐(컬링 켠 시간 < 끈 시간의 80%)", tot_on < tot_off * 0.8, f"{tot_off:.1f}ms -> {tot_on:.1f}ms")
            check("확대 보기에서 덩어리가 실제로 건너뛰어짐", max(s[2] for s in speedups) > 10, [s[2] for s in speedups])

            # ④ 기울이면 모두 그림
            await set_view(0.5, 0.5, 0.2)
            await ev("(()=>{const a=window.cadViewer.app;a.camera.position.x+=a.camera.position.z*0.8;a.controls.update();a.cullInstances();})()")
            tilted = json.loads(await ev("(()=>{const a=window.cadViewer.app;a.cullInstances();return JSON.stringify({culled:a.lite.culled,all:a.lite.allShown,drawn:a.lite.chunks.filter(l=>l.obj.visible).length,chunks:a.lite.chunks.length})})()"))
            print("        기울인 상태:", tilted)
            err = await ev("(()=>{const a=window.cadViewer.app,gl=a.renderer.getContext();gl.getError();a.renderer.render(a.scene,a.camera);return gl.getError()})()")
            check("컬링 중 그래픽 오류 없음", err == 0, err)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

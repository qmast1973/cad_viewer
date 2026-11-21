"""그리기 성능 측정 (헤드리스 Chrome + 이 PC 의 그래픽 카드, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_perf.py <큰.dwg> [--flat] [--cpu]
    --flat  예전 v1(블록 전부 펼침) 파일로 측정(비교용, DWG2LITE_FLAT=1)
    --cpu   그래픽 카드를 쓰지 않고 소프트웨어 그리기(SwiftShader)로 측정
측정(readPixels 로 그래픽 카드가 끝낼 때까지 실제로 기다림; gl.finish 만으로는 ANGLE 에서 기다리지 않음을 2026-11-22 확인): 파일을 연 시간, 실제로 쓰인 그래픽 장치, 맞춤 화면·확대 화면에서 한 화면을 그리는 데 걸리는 시간(gl.finish 로 끝까지 기다림),
      드래그처럼 카메라를 계속 움직일 때의 초당 화면 수, 그리기 호출 수·선분 수. 결과는 JSON 한 줄로도 출력한다."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os, time, statistics
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
DWG = [a for a in sys.argv[1:] if not a.startswith('--')][0]
FLAT = '--flat' in sys.argv
CPU = '--cpu' in sys.argv
PORT, DBG = 8795, 9340
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'


async def main():
    env = dict(os.environ)
    if FLAT:
        env['DWG2LITE_FLAT'] = '1'
    cache = os.path.join(os.path.expanduser('~'), 'AppData', 'Local', 'Temp', 'cad-viewer-cache')
    for f in Path(cache).glob('*.cadlite') if Path(cache).exists() else []:
        try:
            f.unlink()
        except OSError:
            pass
    srv = subprocess.Popen(['node', '--max-old-space-size=8192', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    prof = tempfile.mkdtemp()
    gpu_flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if CPU else ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-software-rasterizer']
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--disable-cache', '--mute-audio', '--no-first-run',
                             '--window-size=1280,800', *gpu_flags, f'http://127.0.0.1:{PORT}/index.html'])
    result = {'file': Path(DWG).name[:30], 'format': 'v1(펼침)' if FLAT else 'v2(인스턴스)', 'mode': 'CPU' if CPU else 'GPU'}
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

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            result['gl'] = await ev("""(()=>{const gl=window.cadViewer.app.renderer.getContext();const e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()""")
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await ev("document.getElementById('status-stats').textContent = ''")
            t0 = time.time()
            await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
            st = None
            for _ in range(480):
                await asyncio.sleep(1)
                st = await ev("document.getElementById('status-stats').textContent")
                if '선분' in (st or ''):
                    break
            result['open_sec'] = round(time.time() - t0, 1)
            result['stats'] = st
            await asyncio.sleep(3)
            if not (st and '선분' in st):
                print('열리지 않음', json.dumps(result, ensure_ascii=False)); return

            js_measure = """(async()=>{const a=window.cadViewer.app, gl=a.renderer.getContext(); const N=%d; const ts=[];
              const px=new Uint8Array(4); gl.getError(); for(let i=0;i<3;i++){a.renderer.render(a.scene,a.camera);} gl.finish(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
              for(let i=0;i<N;i++){ const t=performance.now(); a.renderer.render(a.scene,a.camera); gl.finish(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); ts.push(performance.now()-t); }
              ts.sort((x,y)=>x-y); const err=gl.getError();
              return JSON.stringify({median:ts[Math.floor(ts.length/2)],p95:ts[Math.floor(ts.length*0.95)],min:ts[0],max:ts[ts.length-1],calls:a.renderer.info.render.calls,lines:a.renderer.info.render.lines,err}) })()"""
            result['fit'] = json.loads(await ev(js_measure % 12))
            # 확대 화면(가운데 위쪽으로 이동 후 확대)
            await ev("(()=>{const a=window.cadViewer.app,b=a.fitBox,w=b.max.x-b.min.x,h=b.max.y-b.min.y;a.controls.target.set(b.min.x+0.27*w,b.min.y+0.80*h,0);a.camera.position.set(b.min.x+0.27*w,b.min.y+0.80*h,a.camera.position.z);a.controls.update();window.cadViewer.zoom(0.12);a.controls.update();})()")
            await asyncio.sleep(2)
            result['zoom'] = json.loads(await ev(js_measure % 12))
            # 드래그처럼 카메라를 계속 움직일 때 3초 동안 그린 화면 수
            fps = await ev("""(async()=>{const a=window.cadViewer.app,gl=a.renderer.getContext(); const px2=new Uint8Array(4); const start=performance.now(); let frames=0; const t=a.controls.target.clone();
              while(performance.now()-start<3000){ const k=frames*3; a.controls.target.set(t.x+k,t.y,0); a.camera.position.x=t.x+k; a.controls.update(); a.renderer.render(a.scene,a.camera); gl.finish(); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px2); frames++; }
              return frames/((performance.now()-start)/1000) })()""")
            result['pan_fps'] = round(fps, 1) if isinstance(fps, (int, float)) else fps
            mem = await ev("(()=>{const m=performance.memory;return m?JSON.stringify({jsHeapMB:Math.round(m.usedJSHeapSize/1e6)}):null})()")
            result['memory'] = json.loads(mem) if mem else None
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print('결과', json.dumps(result, ensure_ascii=False))


asyncio.run(main())

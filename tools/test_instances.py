"""v2(블록 인스턴스) 도면 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python tools/test_instances.py <큰.dwg> [스크린샷 폴더]
확인: ① 인스턴스 덩어리가 만들어지고 그래픽 오류(getError)가 없음 ② 레이어 끄기/켜기 ③ 밝은/어두운 테마 ④ 레이어 투명도 ⑤ 눈금 잡기(스냅)가 인스턴스 꼭짓점에 붙음
      ⑥ 인스턴스 화면이 펼친(v1) 화면과 거의 같음(v1 = 환경변수 DWG2LITE_FLAT=1 로 만든 파일, --v1-shot 폴더가 있을 때)"""
import asyncio, base64, json, urllib.request, subprocess, tempfile, sys, shutil, os, io
from pathlib import Path
import numpy as np
from PIL import Image
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
DWG = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.gettempdir()
PORT, DBG = 8795, 9338
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info)
    if not ok:
        fails.append(name)


def lit(png_bytes, region=(50, 770)):
    a = np.array(Image.open(io.BytesIO(png_bytes)).convert('RGB')).astype(int)[region[0]:region[1], 90:1210]   # 좌우 도구 상자 제외
    return int((a.sum(axis=2) > 120).sum()), a


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
                return b

            await send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 1, 'mobile': False})
            doc = await send('DOM.getDocument')
            node = await send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '#fileInput'})
            await ev("document.getElementById('status-stats').textContent = ''")
            await send('DOM.setFileInputFiles', {'files': [DWG], 'nodeId': node['nodeId']})
            st = None
            for _ in range(240):
                await asyncio.sleep(1)
                st = await ev("document.getElementById('status-stats').textContent")
                if '선분' in (st or ''):
                    break
            check("도면 열림", st and '선분' in st, st)
            await asyncio.sleep(2)

            # ① 인스턴스 덩어리와 그래픽 오류
            info = json.loads(await ev("""(()=>{const a=window.cadViewer.app;const L=a.lite.lines;const gl=a.renderer.getContext();
              gl.getError(); a.renderer.render(a.scene,a.camera); const err=gl.getError();
              return JSON.stringify({v:a.lite.head.version,total:L.length,inst:L.filter(l=>l.inst).length,err,calls:a.renderer.info.render.calls}) })()"""))
            check("v2 형식이고 인스턴스 덩어리가 있음", info['v'] == 2 and info['inst'] > 0, info)
            check("그래픽 오류 없음(getError == 0)", info['err'] == 0, info['err'])

            base_png = await shot('inst_base.png')
            base_lit, base_arr = lit(base_png)
            check("화면에 선이 그려짐", base_lit > 5000, base_lit)

            # ② 레이어 끄기/켜기: 인스턴스가 가장 많은 레이어를 고른다
            lay = await ev("""(()=>{const a=window.cadViewer.app;const cnt={};for(const l of a.lite.lines){ if(!l.inst) continue; const nm=l.obj.parent.name.replace(/^layer_/,''); cnt[nm]=(cnt[nm]||0)+l.inst.n*l.obj.geometry.attributes.position.count; }
              return Object.entries(cnt).sort((x,y)=>y[1]-x[1])[0][0]; })()""")
            await ev(f"window.cadViewer.app.toggleLayer({json.dumps(lay)}, false)")
            await asyncio.sleep(1.2)
            off_lit, _ = lit(await shot('inst_layer_off.png'))
            check(f"레이어 '{lay}' 끄면 밝은 픽셀이 줄어듦", off_lit < base_lit * 0.97, f"{base_lit} -> {off_lit}")
            await ev(f"window.cadViewer.app.toggleLayer({json.dumps(lay)}, true)")
            await asyncio.sleep(1.2)
            on_lit, on_arr = lit(await shot())
            same = int((np.abs(on_arr - base_arr).sum(axis=2) > 60).sum())
            check("다시 켜면 원래 화면으로 돌아옴", same < 50, f"달라진 픽셀 {same}")

            # ③ 테마
            await ev("window.cadViewer.setTheme('light')")
            await asyncio.sleep(1.5)
            light_png = await shot('inst_light.png')
            la = np.array(Image.open(io.BytesIO(light_png)).convert('RGB')).astype(int)
            check("밝은 테마: 바탕이 밝아지고 선이 어두운 색으로 보임", la[400, 150].sum() > 600 and int((la[50:770, 90:1210].sum(axis=2) < 200).sum()) > 3000, tuple(la[400, 150]))
            await ev("window.cadViewer.setTheme('dark')")
            await asyncio.sleep(1.5)
            d_lit, d_arr = lit(await shot())
            same = int((np.abs(d_arr - base_arr).sum(axis=2) > 60).sum())
            check("어두운 테마로 돌아오면 원래 화면", same < 50, f"달라진 픽셀 {same}")

            # ④ 투명도(인스턴스 재질의 불투명도가 바뀌고 화면이 어두워짐)
            await ev(f"window.cadTools.setLayerTransparency({json.dumps(lay)}, 80)")
            await asyncio.sleep(1.2)
            op = await ev(f"""(()=>{{const a=window.cadViewer.app;const o=[];for(const l of a.lite.lines){{ if(l.inst && l.obj.parent.name==='layer_'+{json.dumps(lay)}) o.push(l.obj.material.opacity)}} return JSON.stringify({{n:o.length,min:Math.min(...o),max:Math.max(...o)}}) }})()""")
            op = json.loads(op)
            check("투명도 80% → 인스턴스 재질 불투명도 약 0.2", op['n'] > 0 and abs(op['max'] - 0.2) < 0.01, op)
            tr_lit, _ = lit(await shot('inst_transp.png'))
            check("투명도를 주면 밝은 픽셀이 줄어듦", tr_lit < base_lit, f"{base_lit} -> {tr_lit}")
            await ev(f"window.cadTools.setLayerTransparency({json.dumps(lay)}, 0)")
            await asyncio.sleep(1.2)
            r_lit, r_arr = lit(await shot())
            same = int((np.abs(r_arr - base_arr).sum(axis=2) > 60).sum())
            check("투명도 0%로 되돌리면 원래 화면", same < 50, f"달라진 픽셀 {same}")

            # ⑤ 눈금 잡기: 인스턴스 하나의 꼭짓점을 화면 좌표로 바꿔 거기를 누르면 그 점에 붙는지
            target = json.loads(await ev("""(()=>{const a=window.cadViewer.app;
              // 확대해서 한 삽입이 크게 보이게 한다
              const L=a.lite.lines.filter(l=>l.inst&&l.inst.n>=3&&l.obj.geometry.attributes.position.count>=8&&l.obj.parent.visible);
              const l=L[Math.floor(L.length/3)]; const p=l.obj.geometry.attributes.position.array;
              const k=1; const A=l.inst.A,B=l.inst.B; const x=A[k*3]*p[0]+A[k*3+1]*p[1]+A[k*3+2], y=B[k*3]*p[0]+B[k*3+1]*p[1]+B[k*3+2];
              a.controls.target.set(x,y,0); a.camera.position.set(x,y,a.camera.position.z); a.controls.update(); window.cadViewer.zoom(0.002);
              a.controls.update(); return JSON.stringify({x,y}) })()"""))
            await asyncio.sleep(1.5)
            sp = json.loads(await ev("""(()=>{const a=window.cadViewer.app;const v=new THREE.Vector3(%f,%f,0).project(a.camera);const r=a.renderer.domElement.getBoundingClientRect();
              return JSON.stringify({sx:r.left+(v.x+1)/2*r.width, sy:r.top+(1-v.y)/2*r.height, W:r.width,H:r.height}) })()""" % (target['x'], target['y'])))
            ok_view = 0 <= sp['sx'] <= sp['W'] and 0 <= sp['sy'] <= sp['H']
            check("확대한 뒤 대상 꼭짓점이 화면 안에 있음", ok_view, sp)
            if ok_view:
                await ev("window.cadTools.clearRecords && window.cadTools.clearRecords(); window.cadTools.setTool('coord')")
                for typ in ('mousePressed', 'mouseReleased'):
                    await send('Input.dispatchMouseEvent', {'type': typ, 'x': sp['sx'], 'y': sp['sy'], 'button': 'left', 'clickCount': 1})
                await asyncio.sleep(1)
                rec = json.loads(await ev("JSON.stringify(window.cadTools.records())"))
                o = json.loads(await ev("JSON.stringify(window.cadViewer.app.lite.head.origin)"))
                got = (rec[-1]['x'], rec[-1]['y']) if rec else None
                want = (target['x'] + o[0], target['y'] + o[1])
                d = ((got[0] - want[0]) ** 2 + (got[1] - want[1]) ** 2) ** 0.5 if got else 1e9
                check("눈금 잡기가 인스턴스 꼭짓점에 정확히 붙음(오차 < 0.05)", d < 0.05, f"기록 {got} 기대 {want} 거리 {d:.4f}")
            final_err = await ev("(()=>{const gl=window.cadViewer.app.renderer.getContext(); window.cadViewer.app.renderer.render(window.cadViewer.app.scene,window.cadViewer.app.camera); return gl.getError()})()")
            check("마지막까지 그래픽 오류 없음", final_err == 0, final_err)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

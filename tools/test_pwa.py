"""설치형 웹앱(PWA) 시험 (헤드리스 Chrome, 소리 끔, 시험이 띄운 서버·브라우저는 끝나면 종료).
  python -X utf8 tools/test_pwa.py
확인: 매니페스트(이름·아이콘·공유 받기)가 올바르고, 서비스 워커가 앱 파일을 저장하며, 인터넷이 끊겨도 앱이 열리고(오프라인),
      "공유 → CAD 뷰어" 처럼 파일이 POST 로 들어오면 앱이 열려서 그 도면이 저절로 열리는지."""
import asyncio, json, urllib.request, subprocess, tempfile, sys, shutil, os
from pathlib import Path
import websockets

ROOT = str(Path(__file__).resolve().parent.parent)
PORT, DBG = 8795, 9349
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
fails = []


def check(name, ok, info=""):
    print(("  OK  " if ok else " FAIL ") + name, info, flush=True)
    if not ok:
        fails.append(name)


async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--mute-audio', '--no-first-run',
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

            await send('Page.enable')
            await send('Network.enable')
            # 매니페스트
            man = await ev("fetch('manifest.webmanifest').then(r=>r.json())")
            check("매니페스트: 이름·시작 주소·독립 창", man['name'] == 'CAD 뷰어' and man['display'] == 'standalone' and 'index.html' in man['start_url'], man.get('name'))
            check("매니페스트: 아이콘 192·512·마스커블", {i['sizes'] for i in man['icons']} >= {'192x192', '512x512'} and any(i.get('purpose') == 'maskable' for i in man['icons']))
            check("매니페스트: 공유 받기(DWG·DXF)", man['share_target']['method'] == 'POST' and '.dwg' in json.dumps(man['share_target']['params']['files'][0]['accept']))
            for ic in man['icons']:
                st = await ev("fetch('%s').then(r=>r.status)" % ic['src'])
                check(f"아이콘 {ic['sizes']} 내려받아짐", st == 200, st)
            # 서비스 워커
            ready = await ev("navigator.serviceWorker.ready.then(r=>Boolean(r.active))")
            check("서비스 워커가 켜짐", ready is True)
            await asyncio.sleep(2)
            keys = await ev("caches.keys()")
            core = await ev("caches.open(%s).then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname.split('/').pop()))" % json.dumps(keys[0] if keys else 'x'))
            check("앱 파일이 폰·PC 에 저장됨(캐시)", 'cad-tools.js' in core and 'dwg2lite.wasm' in core and 'cad-vendor.bundle.js' in core, core)
            # 오프라인으로 다시 열기
            await send('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': 0, 'uploadThroughput': 0})
            await send('Page.navigate', {'url': f'http://127.0.0.1:{PORT}/index.html?pwa=1'})
            await asyncio.sleep(3)
            ok = await ev("typeof window.cadViewer === 'object' && typeof window.cadTools === 'object'")
            check("인터넷이 끊겨도 앱이 열림(오프라인)", ok is True)
            await send('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
            # 공유로 열기: 파일을 share-target 으로 POST → 서비스 워커가 맡아 두고 앱으로 이동 → 도면이 열림
            line = lambda a, b, c, d: "0\n" + "LINE\n8\n0\n10\n%s\n20\n%s\n30\n0\n11\n%s\n21\n%s\n31\n0\n" % (a, b, c, d)
            dxf = "0\nSECTION\n2\nENTITIES\n" + line(0, 0, 100, 100) + line(0, 40, 100, 40) + line(300, 0, 400, 0) + "0\nENDSEC\n0\nEOF\n"
            await send('Page.navigate', {'url': f'http://127.0.0.1:{PORT}/index.html?pwa=1'})
            await asyncio.sleep(3)
            r = await ev("""(async()=>{const fd=new FormData();fd.append('file',new File([%s],'shared_test.dxf'));
              const res=await fetch('share-target',{method:'POST',body:fd});return [res.status,res.url.split('/').pop()]})()""" % json.dumps(dxf))
            check("공유(POST)를 받으면 앱 화면으로 이동시킴", r and r[0] == 200 and 'shared=1' in r[1], r)
            await send('Page.navigate', {'url': f'http://127.0.0.1:{PORT}/index.html?pwa=1&shared=1'})
            opened = False
            for _ in range(40):
                await asyncio.sleep(1)
                if await ev("window.cadViewer && window.cadViewer.app.currentFilename === 'shared_test.dxf' && Boolean(window.cadViewer.app.lite) && window.cadViewer.app.lite.head.stats.segments >= 3"):
                    opened = True
                    break
            check("공유한 도면이 저절로 열림", opened)
            left = await ev("caches.open('cadviewer-shared').then(c=>c.keys()).then(k=>k.length)")
            check("열고 나면 임시로 맡아 둔 파일은 지워짐", left == 0, left)
            diag = await ev("window.cadDiag()")
            check("설치 진단 글(버전 글자를 누르면 뜸)에 매니페스트·서비스 워커·설치 신호가 나옴", '매니페스트: 200' in diag and '서비스 워커' in diag and '설치 가능 신호' in diag, diag.replace(chr(10), ' | ')[:160])
            shown = False
            for _ in range(10):                      # 크롬이 '설치할 수 있는 앱'으로 인정하면 beforeinstallprompt 가 와서 설치 단추가 나타난다
                if (await ev("getComputedStyle(document.getElementById('installBtn')).display")) != 'none':
                    shown = True
                    break
                await asyncio.sleep(1)
            check("크롬이 설치 가능한 앱으로 인식함(앱 설치 단추가 나타남)", shown)
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print("\n>> 모두 통과 <<" if not fails else f"\n>> 실패 {len(fails)}건: {fails}")
    sys.exit(1 if fails else 0)

asyncio.run(main())

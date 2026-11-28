"""파일 열기 선택창 시험: PC(선택창 API 있음)에서는 확장자 필터(accept)가 유지되고, 폰처럼 API 가 없으면 필터를 풀어 DWG·DXF 가 회색으로 나오지 않게 한다. python -X utf8 tools/test_picker.py <cad-viewer 폴더>"""
import asyncio, json, urllib.request, subprocess, tempfile, shutil, os, sys
import websockets
ROOT = sys.argv[1]
PORT, DBG = 8795, 9344
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
async def main():
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools', 'server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, '--headless=new', f'--remote-debugging-port={DBG}', f'--user-data-dir={prof}', '--mute-audio', '--no-first-run', f'http://127.0.0.1:{PORT}/index.html'])
    try:
        await asyncio.sleep(4)
        tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{DBG}/json').read().decode())
        t = [x for x in tabs if x.get('type') == 'page' and str(PORT) in x.get('url', '')][0]
        async with websockets.connect(t['webSocketDebuggerUrl'], max_size=None) as ws:
            n = 0
            async def ev(js):
                nonlocal n
                n += 1
                await ws.send(json.dumps({'id': n, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True, 'awaitPromise': True}}))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get('id') == n: return r.get('result', {}).get('result', {}).get('value')
            print('PC(선택창 API 있음): accept 속성 =', await ev("document.getElementById('fileInput').getAttribute('accept')"))
            # 폰처럼 선택창 API 가 없는 환경을 흉내: API 를 지우고 열기 단추를 누르면 accept 가 풀려야 한다
            await ev("delete window.showOpenFilePicker; window.showOpenFilePicker = undefined; document.getElementById('fileInput').click = () => {}; document.getElementById('openBtn').click(); 1")
            await asyncio.sleep(0.5)
            print('폰(API 없음): 열기 누른 뒤 accept 속성 =', await ev("document.getElementById('fileInput').getAttribute('accept')"))
    finally:
        proc.terminate(); srv.terminate(); await asyncio.sleep(1); shutil.rmtree(prof, ignore_errors=True)
asyncio.run(main())

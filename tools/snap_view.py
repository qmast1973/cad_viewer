import subprocess
import time
import urllib.request
import json
import base64
import websocket

edge = subprocess.Popen([
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--headless=new", "--mute-audio", "--remote-debugging-port=9227", "--remote-allow-origins=*",
    "--window-size=1280,800",
    "http://127.0.0.1:8795/index.html"
])
time.sleep(1.5)
try:
    with urllib.request.urlopen("http://127.0.0.1:9227/json") as r:
        tabs = json.loads(r.read().decode())
        ws_url = [t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page"][0]
    ws = websocket.create_connection(ws_url)
    
    # 1. 샘플 로드 호출 및 에러 검출
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": 'window.cadViewer.loadSample("sample.dwg")',
            "awaitPromise": True
        }
    }))
    msg1 = json.loads(ws.recv())
    print("loadSample res:", msg1)
    
    # 5초간 대기하면서 매 초마다 렌더링 상태 확인
    for sec in range(10):
        time.sleep(1.0)
        ws.send(json.dumps({"id": 100 + sec, "method": "Runtime.evaluate", "params": {"expression": "window.cadViewer.getState().filename", "returnByValue": True}}))
        m = json.loads(ws.recv())
        val = m.get("result", {}).get("result", {}).get("value")
        print(f"Sec {sec+1}: filename = {val}")
        if val == "sample.dwg":
            break
    
    # 2. 콘솔 에러 및 상태 확인
    ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "JSON.stringify(window.cadViewer.getState())", "returnByValue": True}}))
    state_res = json.loads(ws.recv())
    print("State:", state_res.get("result", {}).get("result", {}).get("value"))
    
    # 3. 스크린샷 캡처
    ws.send(json.dumps({"id": 3, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 3:
            with open("C:/CnvWorkSpace/작업/cad-viewer/tools/current_view.png", "wb") as f:
                f.write(base64.b64decode(msg["result"]["data"]))
            print("Screenshot saved to tools/current_view.png")
            break
    ws.close()
finally:
    edge.terminate()

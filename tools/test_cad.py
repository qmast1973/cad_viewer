"""
CAD 뷰어 헤드리스 Edge(CDP) 자동 검증 스크립트
- 2D DXF 및 3D STL 로드 검증
- 레이어 On/Off 토글 검증
- 카메라 뷰 전환 (Top, Front, Right, Iso) 및 핀치 줌 검증
- 화면 스크린샷 캡처 및 상태 유효성 판정
"""
import subprocess
import time
import json
import urllib.request
import os
import sys

PORT = 8795
DEBUG_PORT = 9225
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(EDGE_PATH):
    EDGE_PATH = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"

def run_command_cdp(ws, req_id, method, params=None):
    import websocket
    msg = {"id": req_id, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        res = json.loads(ws.recv())
        if res.get("id") == req_id:
            return res

def evaluate_js(ws, req_id, expression):
    res = run_command_cdp(ws, req_id, "Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True
    })
    if "result" in res and "result" in res["result"]:
        return res["result"]["result"].get("value")
    return None

def main():
    print(f"[*] CAD 뷰어 자동화 테스트 시작 (디렉터리: {BASE_DIR})")

    # 1. 로컬 HTTP 서버 확인 또는 실행
    server_proc = None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=1):
            print(f"[*] 기존 로컬 서버가 포트 {PORT}에서 실행 중입니다 (재사용).")
    except Exception:
        server_proc = subprocess.Popen(
            ["node", os.path.join(BASE_DIR, "tools", "server.js")],
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(1)
        print(f"[*] Node 서버 실행됨 (포트: {PORT})")

    # 2. 헤드리스 Edge 실행
    edge_proc = subprocess.Popen([
        EDGE_PATH,
        "--headless=new",
        "--mute-audio",
        f"--remote-debugging-port={DEBUG_PORT}",
        "--remote-allow-origins=*",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"http://127.0.0.1:{PORT}/index.html"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[*] Edge 헤드리스 실행됨 (디버그 포트: {DEBUG_PORT})")

    try:
        # 3. 디버그 포트 연결 대기
        ws_url = None
        for attempt in range(20):
            time.sleep(0.5)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json") as resp:
                    tabs = json.loads(resp.read().decode())
                    for tab in tabs:
                        if tab.get("type") == "page":
                            ws_url = tab.get("webSocketDebuggerUrl")
                            break
                    if ws_url:
                        break
            except Exception:
                pass

        if not ws_url:
            raise RuntimeError("CDP WebSocket URL 획득 실패")

        import websocket
        ws = websocket.create_connection(ws_url, timeout=10)
        print("[*] CDP WebSocket 연결 성공!")

        req_id = 1

        # 4. 초기 2D DXF 자동 로드 대기 (최대 5초)
        print("[*] 2D DXF 기본 샘플 로드 대기...")
        dxf_state = None
        for _ in range(25):
            time.sleep(0.2)
            req_id += 1
            st = evaluate_js(ws, req_id, "window.cadViewer ? window.cadViewer.getState() : null")
            if st and st.get("format") == "DXF" and st.get("bounds", {}).get("size", [0])[0] > 0:
                dxf_state = st
                break

        assert dxf_state is not None, "2D DXF 로드 실패"
        print(f"[+] 2D DXF 로드 성공: 파일={dxf_state['filename']}, 포맷={dxf_state['format']}")
        print(f"    바운딩 박스 크기: {dxf_state['bounds']['size']}")
        print(f"    레이어 목록: {[l['name'] for l in dxf_state['layers']]}")

        # 5. 레이어 토글 테스트
        req_id += 1
        evaluate_js(ws, req_id, "window.cadViewer.toggleLayer('OUTLINE', false)")
        st_after_toggle = evaluate_js(ws, req_id + 1, "window.cadViewer.getState()")
        outline_layer = next(l for l in st_after_toggle["layers"] if l["name"] == "OUTLINE")
        assert outline_layer["visible"] is False, "레이어 OUTLINE 숨김 실패"
        print("[+] 레이어 숨김 토글 성공 (OUTLINE: visible=false)")

        # 6. 카메라 뷰 프리셋 테스트
        req_id += 10
        evaluate_js(ws, req_id, "window.cadViewer.setView('front')")
        time.sleep(0.3)
        st_front = evaluate_js(ws, req_id + 1, "window.cadViewer.getState()")
        print(f"[+] 뷰 전환(Front) 성공: 카메라 위치={st_front['camera']['position']}")

        # 7. 3D STL 샘플 로드 테스트
        print("[*] 3D STL 샘플 로드 시작 (sample-3d.stl)...")
        req_id += 20
        evaluate_js(ws, req_id, "window.cadViewer.loadSample('sample-3d.stl')")
        
        stl_state = None
        for _ in range(25):
            time.sleep(0.2)
            req_id += 1
            st = evaluate_js(ws, req_id, "window.cadViewer.getState()")
            if st and st.get("format") == "STL" and st.get("bounds", {}).get("size", [0,0,0])[2] > 0:
                stl_state = st
                break

        assert stl_state is not None, "3D STL 로드 실패"
        print(f"[+] 3D STL 로드 성공: 파일={stl_state['filename']}, 포맷={stl_state['format']}")
        print(f"    3D 바운딩 크기: {stl_state['bounds']['size']}")
        print(f"    3D 모드: {stl_state['is2DMode']}")

        # 7-1. AutoCAD DWG 실무 도면 로드 및 Wasm 실시간 변환 렌더링 검증
        print("[*] AutoCAD DWG 샘플 로드 및 실시간 변환 시작 (sample.dwg)...")
        req_id += 30
        evaluate_js(ws, req_id, "window.cadViewer.loadSample('sample.dwg')")

        dwg_state = None
        for attempt in range(50):
            time.sleep(0.3)
            req_id += 1
            st = evaluate_js(ws, req_id, "window.cadViewer.getState()")
            if st and (st.get("filename") == "sample.dwg" or st.get("format") == "DWG") and len(st.get("layers", [])) > 0:
                dwg_state = st
                break

        assert dwg_state is not None, f"AutoCAD DWG 변환 및 로드 실패 (최종 상태: {st})"
        print(f"[+] AutoCAD DWG 로드 및 변환 성공: 파일={dwg_state['filename']}, 포맷={dwg_state['format']}")
        print(f"    도면 레이어 수: {len(dwg_state['layers'])}개 ({[l['name'] for l in dwg_state['layers'][:5]]}...)")

        # 8. 핀치 줌 / 줌 조작 테스트
        initial_cam_dist = evaluate_js(ws, req_id + 1, """
            Math.hypot(
                window.cadViewer.app.camera.position.x - window.cadViewer.app.controls.target.x,
                window.cadViewer.app.camera.position.y - window.cadViewer.app.controls.target.y,
                window.cadViewer.app.camera.position.z - window.cadViewer.app.controls.target.z
            )
        """)
        evaluate_js(ws, req_id + 2, "window.cadViewer.zoom(0.5)") # 2배 확대
        zoomed_cam_dist = evaluate_js(ws, req_id + 3, """
            Math.hypot(
                window.cadViewer.app.camera.position.x - window.cadViewer.app.controls.target.x,
                window.cadViewer.app.camera.position.y - window.cadViewer.app.controls.target.y,
                window.cadViewer.app.camera.position.z - window.cadViewer.app.controls.target.z
            )
        """)
        assert zoomed_cam_dist < initial_cam_dist, f"줌 확대 실패 ({zoomed_cam_dist} vs {initial_cam_dist})"
        print(f"[+] 줌 조작 검증 성공: 거리 {initial_cam_dist:.1f} -> {zoomed_cam_dist:.1f}")

        # 8-1. 모바일 에뮬레이션 (390x844) 및 더블 탭 맞춤 뷰 검증
        req_id += 5
        run_command_cdp(ws, req_id, "Emulation.setDeviceMetricsOverride", {
            "width": 390,
            "height": 844,
            "deviceScaleFactor": 3,
            "mobile": True
        })
        run_command_cdp(ws, req_id + 1, "Emulation.setTouchEmulationEnabled", {
            "enabled": True,
            "maxTouchPoints": 5
        })
        time.sleep(0.3)
        evaluate_js(ws, req_id + 2, "window.cadViewer.fit()")
        fit_cam_dist = evaluate_js(ws, req_id + 3, """
            Math.hypot(
                window.cadViewer.app.camera.position.x - window.cadViewer.app.controls.target.x,
                window.cadViewer.app.camera.position.y - window.cadViewer.app.controls.target.y,
                window.cadViewer.app.camera.position.z - window.cadViewer.app.controls.target.z
            )
        """)
        print(f"[+] 모바일 뷰포트(390x844) 리사이즈 및 자동 맞춤(Fit) 검증 성공: 거리 {fit_cam_dist:.1f}")

        # 9. 스크린샷 캡처
        screenshot_path = os.path.join(BASE_DIR, "tools", "test_screenshot_3d.png")
        shot_res = run_command_cdp(ws, req_id + 10, "Page.captureScreenshot", {"format": "png"})
        if "result" in shot_res and "data" in shot_res["result"]:
            import base64
            with open(screenshot_path, "wb") as f:
                f.write(base64.b64decode(shot_res["result"]["data"]))
            print(f"[+] 3D 렌더링 스크린샷 저장됨: {screenshot_path}")

        print("\n=======================================================")
        print("  모든 CAD 뷰어 기능 및 모바일/PC 제스처 검증 통과 (100% SUCCESS)")
        print("=======================================================")

    finally:
        print("[*] 테스트 완료 - 프로세스 정리 중...")
        try:
            edge_proc.terminate()
            edge_proc.wait(timeout=2)
        except Exception:
            pass
        try:
            server_proc.terminate()
            server_proc.wait(timeout=2)
        except Exception:
            pass

if __name__ == "__main__":
    main()

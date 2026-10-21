# 경량 CAD 인앱 뷰어 (CAD Viewer - DWG / DXF / STL / OBJ)

알씨 캐드뷰어(ALSeeCAD, 7.46MB Delphi VCL/OpenGL)의 핵심 도면·모델 열람 기능을 웹 표준 기술(Three.js + LibreDWG WebAssembly)로 재구축한 초경량 2D/3D CAD 인앱 웹앱입니다.

- **위치**: `C:\CnvWorkSpace\작업\cad-viewer`
- **구동**: `http://127.0.0.1:8795/index.html` (로컬 백그라운드 서버 가동 중)
- **스킬**: `C:\CnvWorkSpace\스킬\cad-viewer`

---

## 1. 주요 기능 및 특징

1. **AutoCAD DWG 완벽 지원 (실무 도면 1순위)**:
   - LibreDWG WebAssembly(Wasm) 기반 초고속 실시간 파싱 (R14 ~ AutoCAD 2018+ 지원)
   - 파일 선택 창이나 브라우저 드래그 앤 드롭으로 `.dwg` 파일을 넣으면 즉시 0.3초 만에 렌더링
   - 다중 레이어, 텍스트(MTEXT), 원/호, 블록(INSERT), 해치(HATCH) 등 도면 객체 복원
2. **2D 도면 열람 (DXF)**:
   - AutoCAD R12 ~ 2018 DXF 완벽 파싱 (`dxf-parser`)
   - 지원 엔터티: `LINE`, `LWPOLYLINE`(Bulge 원호 보간 지원), `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `TEXT`, `MTEXT`, `INSERT`(블록 중첩 지원), `3DFACE`
   - AutoCAD 표준 256 ACI 색상 및 레이어별 색상 매핑
   - 레이어 패널을 통한 레이어별 실시간 보이기/숨기기(On/Off) 토글
   - 기본 2D 패닝 모드(회전 잠금)로 모바일 및 PC에서 도면 각도가 틀어지지 않고 안정적으로 이동/확대
3. **3D 모델 열람 (STL & OBJ)**:
   - STL 파일 (ASCII 및 빠른 바이너리) 파싱 및 부드러운 법선 셰이딩
   - OBJ 파일 (다중 메쉬 및 그룹) 렌더링
   - 3D 자유 궤도 회전(Orbit), 조명 및 와이어프레임 토글 모드
4. **모바일 최적화 제스처 (`touch-action: none !important;`)**:
   - **한 손가락 드래그**: 2D 모드에서는 패닝(도면 이동), 3D 모드에서는 궤도 회전
   - **두 손가락 드래그**: 화면 패닝(이동)
   - **두 손가락 핀치**: 중심점 기준 정밀 줌 인/줌 아웃
   - **더블 탭**: 화면 자동 맞춤(Fit to Screen / Home 뷰 리셋)
   - **우측 플로팅 컨트롤러**: 원터치 줌(+/-), Fit 버튼, 뷰 프리셋(Top/Front/Right/Iso)
5. **테마 & 환경**:
   - 다크 테마(AutoCAD 스타일 `#141519` 배경) 및 라이트 테마(`#f8f9fa`) 실시간 전환
   - XY 작업 평면 그리드 및 좌표축 가이드 토글

---

### 큰 DWG 열기 (2026-10-21)
26MB·42MB급 실무 도면도 열립니다. 서버(`tools/server.js`)가 원본 LibreDWG(`bin/libredwg/dwg2dxf.exe`)로 변환한 뒤 `tools/dwg_lite.js` 가 선분·글자만 뽑아 가벼운 이진(`.cadlite`)으로 만들어 화면에 보냅니다. 처음 열기 27MB 약 38초, 같은 파일 다시 열기 약 1초(`%TEMP%\\cad-viewer-cache`). 사용 전 `bin/libredwg/` 에 LibreDWG 0.14 win64 릴리스를 풀어 두어야 합니다(저장소에는 포함하지 않음).
- 직접 변환: `node tools/dwg_lite.js <입력.dwg> <출력.cadlite>` · 시험: `python tools/test_big_dwg.py <큰.dwg>`
- 아직 그리지 않는 것: HATCH·MULTILEADER·LEADER·REGION·OLE (SPLINE 은 제어점 연결선으로 근사).

## 2. 화면 없이 CLI 검사 도구 (에이전트용)

```powershell
python C:\CnvWorkSpace\작업\cad-viewer\tools\inspect_cad.py <도면_또는_모델_경로>
```
`.dwg`, `.dxf`, `.stl`, `.obj` 파일을 화면 없이 터미널에서 즉시 분석하여 레이어, 엔터티 개수, 바운딩 박스를 JSON으로 출력합니다.

### 출력 예시 (JSON)
```json
{
  "file": "bracket-2d.dxf",
  "format": "DXF",
  "layers": ["OUTLINE", "HOLES", "CENTER", "DIM"],
  "layer_count": 4,
  "entities": { "LINE": 20, "ARC": 4, "CIRCLE": 10, "TEXT": 4 },
  "total_entities": 38,
  "bounds": {
    "min": [-15.0, -18.0, 0.0],
    "max": [160.0, 115.0, 0.0],
    "size": [175.0, 133.0, 0.0]
  }
}
```

---

## 3. 에이전트 브리지 API (`window.cadViewer`)

웹 화면에서 AI 에이전트가 직접 뷰어를 제어할 수 있는 브리지 객체입니다.

- `cadViewer.open(file)`: 브라우저 File 객체 로드
- `cadViewer.loadSample(name)`: `sample/` 폴더 내 샘플 로드 (`bracket-2d.dxf`, `gear-2d.dxf`, `sample-3d.stl`)
- `cadViewer.setView(view)`: `'top'` | `'front'` | `'right'` | `'iso'` | `'reset'`
- `cadViewer.fit()`: 모델을 화면 중앙에 가득 차도록 자동 맞춤
- `cadViewer.setTheme(theme)`: `'dark'` | `'light'`
- `cadViewer.setMode(mode)`: `'2d'` (회전 잠금, 드래그 이동) | `'3d'` (자유 궤도 회전)
- `cadViewer.toggleLayer(layerName, visible)`: 특정 레이어 표시/숨김
- `cadViewer.toggleGrid(show)`: 바닥 그리드 On/Off
- `cadViewer.toggleWireframe(show)`: 3D 와이어프레임 On/Off
- `cadViewer.zoom(factor)`: 줌 인(0.8) / 줌 아웃(1.25)
- `cadViewer.getState()`: 현재 파일명, 포맷, 치수(bounds), 레이어 목록, 카메라 위치 등 반환

---

## 4. 자동화 테스트 실행

```powershell
python C:\CnvWorkSpace\작업\cad-viewer\tools\test_cad.py
```
- 로컬 웹 서버 기동 -> Edge 헤드리스(CDP) 접속 -> 2D DXF 자동 로드 -> 레이어 On/Off -> Front 뷰 전환 -> 3D STL 로드 -> 모바일 에뮬레이션(390×844) 리사이즈 및 줌 검증 -> 스크린샷 캡처 완료 후 프로세스 자동 정리.

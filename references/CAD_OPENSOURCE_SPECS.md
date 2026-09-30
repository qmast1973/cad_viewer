# 오픈소스 CAD 엔진 및 레퍼런스 기술 사양서

본 문서는 `cad-platform`에서 활용하는 오픈소스 핵심 라이브러리 및 AutoCAD/CADian 호환성 보장을 위한 기술 레퍼런스입니다.

---

## 1. 선정된 핵심 오픈소스 라이브러리

### ① `@mlightcad/libredwg-web` (WebAssembly DWG Parser)
- **역할**: GNU LibreDWG 공식 C 라이브러리를 WebAssembly(Wasm)로 컴파일한 모듈.
- **지원 포맷**: DWG (R13 ~ R2018+ 버전 바이너리 파일).
- **특징**:
  - 클라이언트 브라우저 및 Node.js 로컬 환경에서 서버 없이 100% 동작.
  - `LibreDwg.dwg_read_data()` 및 `convert()`를 통해 DWG 바이너리를 정형화된 JSON 객체 모델로 변환.
  - 메모리 해제: Wasm 특성상 `libredwg.dwg_free()`를 통한 수동 메모리 관리 수행.

### ② `dxf-writer` (AutoCAD/CADian 호환 CAD 파일 생성기)
- **역할**: DXF 규격에 맞춘 CAD 파일 생성.
- **호환성**: 여러 CAD 프로그램에서 열리는 DXF 생성을 목표로 합니다. 다만 뷰어에 따라 한글 등 일부 표시가 다를 수 있으며(실제 사용 중 DWG FastView에서 글자가 깨지는 경우가 있었음), 모든 CAD 프로그램과의 호환을 보장하지는 않습니다.
- **핵심 API**:
  - `new Drawing()`: 도면 인스턴스 생성
  - `setUnits('Millimeters')`: 밀리미터 단위계 설정
  - `addLayer(name, color, lineType)`: 레이어 정의
  - `drawLine(x1, y1, x2, y2)`: 선분 엔티티 생성
  - `drawCircle(x, y, radius)`: 원 엔티티 생성
  - `toDxfString()`: 표준 CAD 파일 문자열 직렬화

### ③ `dxf-parser` (고속 CAD 데이터 파서)
- **역할**: DXF 텍스트 데이터를 JSON 객체(Entities, Layers, Tables)로 신속히 역직렬화.
- **성능**: 대용량 도면도 밀리초 단위로 파싱하여 Three.js 렌더링 씬으로 공급.

### ④ `Three.js` (WebGL 하드웨어 가속 2D CAD 뷰포트)
- **역할**: GPU 가속을 통한 고성능 CAD 뷰포트 렌더링.
- **기능**:
  - 직교 투영 카메라 (`OrthographicCamera`): 왜곡 없는 1:1 도면 투영.
  - WCS(World Coordinate System) 기반 마우스 좌표 역투영 (Raycasting).
  - 무한 그리드, 십자선 커서, OSNAP 시각화, 실시간 러버밴드(Rubber-band) 렌더링.

---

## 2. 도면 호환성 표준 규격 (AutoCAD & CADian)

1. **파일 헤더 구조**:
   - `$ACADVER`: 도면 포맷 버전 (`AC1015` = AutoCAD 2000, 가장 널리 통용되는 버전).
   - `$INSUNITS`: 4 (Millimeters) 기본 설정.
2. **엔티티 블록 구조**:
   - `LINE`: 시작점 `(10, 20, 30)`과 끝점 `(11, 21, 31)`, 레이어명 `(8)`.
   - `CIRCLE`: 중심점 `(10, 20, 30)`과 반지름 `(40)`, 레이어명 `(8)`.
3. **무손실 라운드트립(Round-trip) 보장**:
   - 생성 → 저장 → 외부 CAD(AutoCAD/CADian) 열람 → 수정 → 저장 → 본 플랫폼 열람 과정에서 좌표값 오차 0.0001mm 이내 유지.

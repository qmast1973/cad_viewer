# Web CAD Studio (cad-platform)

브라우저에서 DWG/DXF 도면을 열어 보고 측정하고 간단히 편집한 뒤 DXF로 저장하는 웹 CAD 뷰어입니다.
사람이 화면으로 쓸 수도 있고, 스크립트나 AI 에이전트가 명령줄(CLI)로 같은 기능을 쓸 수도 있습니다.

> **상태: 베타.** 보기, 측정, DXF 저장·불러오기는 검증했습니다. **저장은 DXF만 지원하고 DWG 저장은 지원하지 않습니다.** 아래 [알려진 한계](#알려진-한계)를 먼저 읽어 주세요.

## 주요 기능

- **도면 열기**: DWG와 DXF (DWG는 AutoCAD 2010 형식 도면으로 검증했고, 다른 버전은 LibreDWG의 지원 범위를 따릅니다)
- **보기**: 확대/축소(휠), 이동(PAN), 전체 맞춤, 레이어 켜기/끄기, 문자 표시 켜기/끄기, 어두운/밝은 화면
- **측정**: 두 점 거리(DIST), 다각형 면적(AREA), 스냅(끝점·중점·중심·노드)
- **편집**: 개체 선택, 이동, 복사·붙여넣기(Ctrl+C/V), 삭제(Delete), 실행 취소/다시 실행(Ctrl+Z/Y), 선(LINE)·원(CIRCLE) 그리기
- **단축키**: P(이동)·M(개체 이동)·L(선)·C(원)·D(거리)·A(면적), Z(전체 맞춤), T(문자 표시), 스냅 F3, 격자 F7, 직교 F8, 취소 Esc (화면 하단 명령창에서 `L`, `C`, `DI`, `HELP`도 사용)
- **저장**: DXF 저장 (개체 색과 문자 정렬 유지, 저장한 파일을 다시 불러오면 같은 도면)
- **CLI**: `open`, `inspect`, `dist`, `area`, `id`, `line`, `circle`, `save`, `clear` (`npm run cli -- --help`)
- **불러오지 못한 개체 안내**: 지원하지 않아 표시하지 못한 개체가 있으면 종류별 개수를 화면 로그와 CLI 결과에 알려 줍니다.

### 화면에 그리는 개체

LINE, LWPOLYLINE/POLYLINE(호 구간 포함), CIRCLE, ARC, ELLIPSE, SPLINE, POINT, SOLID, HATCH(SOLID 채움, 구멍 포함),
TEXT/MTEXT(기준점·회전·`\U+XXXX`·`%%d` 해석), ATTRIB, INSERT(블록 재귀 전개), DIMENSION(치수 블록 전개).
그 외 종류(LEADER, IMAGE 등)는 표시하지 못하며, 표시하지 못한 개수를 알려 줍니다.

## 설치와 실행

필요한 것: **Node.js 24 이상** (`.ts` 파일을 직접 실행하는 기능을 사용합니다. v24.20.0에서 검증)

```powershell
npm install

# DWG를 정확히 읽으려면 (Windows) LibreDWG 실행 파일을 bin/ 에 내려받습니다
powershell -ExecutionPolicy Bypass -File tests/download-libredwg.ps1

npm run dev          # 개발 서버: http://localhost:5173
# 또는
npm run build && npm run preview   # 빌드본: http://localhost:4173
```

- **DWG 열기**는 서버 쪽 변환기(`bin/dwg2dxf.exe`)를 사용합니다. 두 서버(dev, preview) 모두 `/api/parse-dwg`를 제공합니다.
  변환기가 없거나 서버 API가 응답하지 않으면 브라우저 내장 WebAssembly 파서로 대체되며, 이때는 표제란·일부 개체가 빠질 수 있습니다.
- DWG 변환기 실행 파일(`bin/`)은 GPL-3.0이라 저장소에 포함하지 않습니다. 다운로드 스크립트가 공식 릴리스에서 받아 옵니다.
- DWG 관련 기능은 현재 **Windows 전용**입니다 (`.exe` 사용). DXF 보기·저장은 운영체제와 무관합니다.

## 웹 배포 (GitHub Pages)

`main`에 push하면 GitHub Actions(`.github/workflows/pages.yml`)가 정적 빌드를 `https://qmast1973.github.io/cad_viewer/`에 올립니다.
정적 호스팅에는 서버가 없어 **DWG는 브라우저 내장 엔진으로 읽으며, 표제란 등 일부 개체가 빠질 수 있습니다.** DXF 보기·측정·편집·저장은 서버 없이 동일하게 동작합니다. DWG를 정확히 읽으려면 위의 로컬 실행을 사용하세요.

## CLI 예

```powershell
npm run cli -- open my_drawing.dwg          # 도면 열기 (개수, 레이어, 범위, 표시하지 못한 개체)
npm run cli -- dist --p1 "0,0" --p2 "100,50"  # 거리 측정
npm run cli -- line --start "0,0" --end "100,100" --layer WALL
npm run cli -- save --output result.dxf     # DXF 저장 (편집 내용 반영)
```

## 테스트

```powershell
npm test
```

- `test-parse-dxf-text.js`(합성 DXF)와 `test-cad-viewer.js`, `test-compat.js`는 별도 파일 없이 실행됩니다.
- 나머지 테스트는 실제 DWG 도면 `samples/MAIN_COM_01.dwg`가 필요합니다. 이 도면은 **제3자 저작물이라 저장소에 포함하지 않으며**, 파일이 없으면 해당 테스트는 자동으로 건너뜁니다.
  자신의 DWG로 동작을 확인하려면 파일을 열어 화면과 CLI 결과를 비교해 보세요.

## 알려진 한계

- **DWG로는 저장할 수 없습니다. 저장은 DXF만 지원합니다.** DWG는 열기만 가능합니다. 오픈소스 엔진(LibreDWG)으로 만든 DWG는 DWG FastView에서 열리지 않거나, 열려도 문자·테두리 등 개체가 대량으로 빠지는 것을 확인해 DWG 저장을 제거했습니다. CLI `save`에 `.dwg` 경로를 주면 오류를 반환합니다.
- **DXF 저장 시 HATCH(채움)는 채움 없이 경계선으로 저장됩니다.**
- **한글이 포함된 문자는 벡터가 아닌 이미지 방식으로 그려집니다** (글꼴에 한글이 없음). 뷰어에 따라 저장한 DXF의 한글이 깨질 수 있습니다.
- **글자 폭은 0.8배로 보정해 그립니다** (원본 CAD 글꼴이 더 좁아 글자가 겹치는 것을 막기 위한 값이며, 도면마다 어울리지 않을 수 있습니다: `src/components/CadCanvas.tsx`의 `VECTOR_WIDTH_FACTOR`).
- 선 종류(점선 등)와 선 굵기는 표시하지 않습니다.
- CLI로 **DXF 파일**을 열 때는 보조 파서를 사용하므로, DWG를 열 때보다 지원하는 개체가 적습니다.

## 제3자 소프트웨어

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. dxf-json과 libredwg-web(GPL-3.0) 등을 사용합니다.

## 라이선스

[GNU General Public License v3.0](LICENSE) (GPL-3.0-only).
이 프로젝트가 사용하는 dxf-json, @mlightcad/libredwg-web, LibreDWG가 GPL-3.0이므로 같은 라이선스로 배포합니다.
GPL-3.0 구성 요소가 포함된 결과물을 배포할 때는 소스 공개 등 GPL의 의무가 따릅니다.

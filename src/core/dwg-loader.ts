import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { CadModel, cleanCadMText } from './cad-model.ts';

export interface CadFormatDetection {
  type: 'DWG' | 'DXF' | 'UNKNOWN';
  version?: string;
  versionName?: string;
  isTextDxf?: boolean;
}

/**
 * CAD 파일 바이너리 헤더를 읽어 DWG/DXF 여부 및 AutoCAD 버전 정밀 판별
 */
export function detectCadFormat(buffer: ArrayBuffer): CadFormatDetection {
  const bytes = new Uint8Array(buffer.slice(0, 256));
  if (bytes.length < 6) return { type: 'UNKNOWN' };

  // DWG 헤더 매직 넘버 검사 (첫 6바이트: AC10xx)
  const headerStr = String.fromCharCode(...bytes.slice(0, 6));

  const DWG_VERSIONS: Record<string, string> = {
    'AC1006': 'AutoCAD 10 (R10)',
    'AC1009': 'AutoCAD 11/12 (R11/R12)',
    'AC1012': 'AutoCAD 13 (R13)',
    'AC1014': 'AutoCAD 14 (R14)',
    'AC1015': 'AutoCAD 2000 (R2000)',
    'AC1018': 'AutoCAD 2004 (R2004)',
    'AC1021': 'AutoCAD 2007 (R2007)',
    'AC1024': 'AutoCAD 2010 (R2010)',
    'AC1027': 'AutoCAD 2013 (R2013)',
    'AC1032': 'AutoCAD 2018+ (R2018~2026)'
  };

  if (DWG_VERSIONS[headerStr]) {
    return {
      type: 'DWG',
      version: headerStr,
      versionName: DWG_VERSIONS[headerStr]
    };
  }

  // DXF 텍스트 헤더 검사
  try {
    const textHeader = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    if (
      textHeader.startsWith('0') &&
      (textHeader.includes('SECTION') || textHeader.includes('HEADER') || textHeader.includes('ENTITIES'))
    ) {
      return { type: 'DXF', isTextDxf: true };
    }
  } catch (_) {
    // 디코딩 실패 시 무시
  }

  return { type: 'UNKNOWN' };
}

export class DwgLoader {
  private static instance: LibreDwg | null = null;

  /**
   * WebAssembly 인스턴스 초기화 (크래시 또는 예외 발생 시 인스턴스를 파기하여 재발 방지)
   */
  public static resetInstance() {
    this.instance = null;
  }

  public static async getLibreDwg(): Promise<LibreDwg> {
    if (!this.instance) {
      try {
        this.instance = await LibreDwg.create(`${import.meta.env.BASE_URL}wasm`);
      } catch (err: any) {
        console.warn('LibreDwg WASM initialization failed:', err);
        // WASM 초기화 실패를 의도적으로 throw (DXF 폴백으로 처리됨)
        throw new Error('WebAssembly CAD 엔진 초기화 불가능');
      }
    }
    return this.instance;
  }

  /**
   * 브라우저에서 ArrayBuffer 형식의 DWG 바이너리를 읽어 CadModel에 적재
   */
  public static async loadDwgIntoModel(
    buffer: ArrayBuffer,
    model: CadModel
  ): Promise<{ lineCount: number; circleCount: number; polylineCount: number; textCount: number; pointCount: number; versionName?: string; skipped?: Record<string, number> }> {
    // 1. 헤더 사전 검증
    const detection = detectCadFormat(buffer);

    if (detection.type === 'DXF' || detection.isTextDxf) {
      throw new Error('IS_DXF_FILE'); // DXF 파일인 경우 상위에서 DXF 로더로 즉시 자동 우회
    }

    if (detection.type === 'UNKNOWN') {
      throw new Error('표준 AutoCAD DWG 또는 DXF 헤더를 찾을 수 없습니다. 올바른 CAD 도면 파일인지 확인하십시오.');
    }

    // 2. [1차 최우선 실행] 초고속 고안정성 백엔드 파서 API (/api/parse-dwg) 호출
    // 브라우저 샌드박스의 WebAssembly 메모리/어설션 한계를 우회하여 표제란까지 포함해 적재
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/parse-dwg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success' && Array.isArray(data.entities)) {
          const res = model.loadParsedEntities(data);
          return {
            lineCount: res.lineCount,
            circleCount: res.circleCount,
            polylineCount: 0,
            textCount: res.textCount,
            pointCount: 0,
            versionName: detection.versionName,
            skipped: data.skippedEntities // 서버 파서가 처리하지 못한 개체 종류별 개수
          };
        }
      }
    } catch (apiErr) {
      console.warn('Backend parse-dwg API call failed, falling back to client-side WASM:', apiErr);
    }

    // 3. [2차 자동 폴백] 클라이언트 내장 WebAssembly 엔진 시도
    let libredwg: LibreDwg;
    try {
      libredwg = await this.getLibreDwg();
    } catch (e: any) {
      this.resetInstance();
      throw new Error(`WebAssembly CAD 엔진을 초기화할 수 없습니다: ${e.message || e}`);
    }

    const uint8Array = new Uint8Array(buffer);
    let dwg: any = null;

    // DWG 바이너리 파싱 시도 (C 라이브러리 레벨의 크래시를 안전하게 포획)
    try {
      dwg = libredwg.dwg_read_data(uint8Array, Dwg_File_Type.DWG);
    } catch (readErr: any) {
      this.resetInstance(); // 크래시된 WASM 인스턴스 즉시 초기화하여 좀비 상태 방지
      throw new Error(this.formatErrorMessage(readErr, detection));
    }

    if (!dwg) {
      this.resetInstance();
      throw new Error(this.formatErrorMessage(new Error('dwg_read_data returned null'), detection));
    }

    try {
      const db = libredwg.convert(dwg);
      if (!db) {
        throw new Error('DWG 데이터베이스 변환 실패');
      }

      model.clear();
      model.resetLayers();

      let lineCount = 0;
      let circleCount = 0;
      let polylineCount = 0;
      let textCount = 0;
      let pointCount = 0;

      // 1. 최상위 엔티티 목록 (db.entities) 파싱
      const rawEntities: any[] = [];
      if (db && Array.isArray(db.entities)) {
        rawEntities.push(...db.entities);
      }

      // 2. 블록 내부 엔티티 (ModelSpace 등) 파싱
      if (db && db.blocks) {
        for (const blockKey of Object.keys(db.blocks)) {
          const block = db.blocks[blockKey];
          if (block && Array.isArray(block.entities)) {
            rawEntities.push(...block.entities);
          }
        }
      }

      // 레이어 사전 등록 헬퍼
      const ensureLayer = (lName: string) => {
        if (!model.getLayers().some(l => l.name === lName)) {
          if (lName === '7') {
            model.addLayer('7', '#FFE873'); // 주석/텍스트 골드
          } else if (lName === 'SHEET') {
            model.addLayer('SHEET', '#3FB950'); // 도면 틀 녹색
          } else if (lName === '0') {
            model.addLayer('0', '#FFFFFF'); // 기본 흰색
          } else {
            model.addLayer(lName, '#00FFFF');
          }
        }
      };

      for (const ent of rawEntities) {
        const layer = ent.layer || '0';
        ensureLayer(layer);

        // 1. 선분 (LINE)
        const start = ent.startPoint || ent.start || (ent.vertices && ent.vertices[0]);
        const end = ent.endPoint || ent.end || (ent.vertices && ent.vertices[1]);
        if (ent.type === 'LINE' && start && end) {
          model.addLine(
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
            layer
          );
          lineCount++;
        }
        // 2. 원 (CIRCLE)
        else if (ent.type === 'CIRCLE' && (ent.center || ent.centerPoint) && typeof (ent.radius || ent.r) === 'number') {
          const c = ent.center || ent.centerPoint;
          const r = ent.radius || ent.r;
          model.addCircle(
            { x: c.x, y: c.y },
            r,
            layer
          );
          circleCount++;
        }
        // 3. 폴리라인 (LWPOLYLINE / POLYLINE)
        else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
          polylineCount++;
          const pts = ent.vertices;
          for (let i = 0; i < pts.length - 1; i++) {
            model.addLine({ x: pts[i].x, y: pts[i].y }, { x: pts[i + 1].x, y: pts[i + 1].y }, layer);
            lineCount++;
          }
          if ((ent.shape || ent.closed) && pts.length > 2) {
            model.addLine({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }, { x: pts[0].x, y: pts[0].y }, layer);
            lineCount++;
          }
        }
        // 4. 호 (ARC)
        else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
          const startAngle = ent.startAngle || 0;
          const endAngle = ent.endAngle || Math.PI * 2;
          const arcSegments = 16;
          let diff = endAngle - startAngle;
          if (diff < 0) diff += Math.PI * 2;
          const step = diff / arcSegments;

          let prevX = ent.center.x + Math.cos(startAngle) * ent.radius;
          let prevY = ent.center.y + Math.sin(startAngle) * ent.radius;

          for (let s = 1; s <= arcSegments; s++) {
            const angle = startAngle + step * s;
            const curX = ent.center.x + Math.cos(angle) * ent.radius;
            const curY = ent.center.y + Math.sin(angle) * ent.radius;
            model.addLine({ x: prevX, y: prevY }, { x: curX, y: curY }, layer);
            lineCount++;
            prevX = curX;
            prevY = curY;
          }
        }
        // 5. 타원 (ELLIPSE)
        else if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
          const c = ent.center;
          const a = Math.hypot(ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y);
          const b = a * (ent.axisRatio || 0.5);
          const rot = Math.atan2(ent.majorAxisEndPoint.y, ent.majorAxisEndPoint.x);
          const segs = 32;
          let prevX = c.x + a * Math.cos(0) * Math.cos(rot) - b * Math.sin(0) * Math.sin(rot);
          let prevY = c.y + a * Math.cos(0) * Math.sin(rot) + b * Math.sin(0) * Math.cos(rot);
          for (let s = 1; s <= segs; s++) {
            const th = (s / segs) * Math.PI * 2;
            const curX = c.x + a * Math.cos(th) * Math.cos(rot) - b * Math.sin(th) * Math.sin(rot);
            const curY = c.y + a * Math.cos(th) * Math.sin(rot) + b * Math.sin(th) * Math.cos(rot);
            model.addLine({ x: prevX, y: prevY }, { x: curX, y: curY }, layer);
            lineCount++;
            prevX = curX;
            prevY = curY;
          }
        }
        // 6. 해치 / 솔리드 필 (HATCH) - 경계 루프 복원 (원형 단자 및 선분 복원)
        else if (ent.type === 'HATCH' && Array.isArray(ent.boundaryPaths)) {
          for (const bp of ent.boundaryPaths) {
            if (Array.isArray(bp.edges)) {
              for (const edge of bp.edges) {
                if (edge.type === 2 && edge.center && typeof edge.radius === 'number') {
                  model.addCircle({ x: edge.center.x, y: edge.center.y }, edge.radius, layer);
                  circleCount++;
                } else if (edge.type === 1 && edge.start && edge.end) {
                  model.addLine({ x: edge.start.x, y: edge.start.y }, { x: edge.end.x, y: edge.end.y }, layer);
                  lineCount++;
                }
              }
            }
          }
        }
        // 7. 텍스트 (TEXT / MTEXT)
        else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && (ent.text || ent.string)) {
          const rawText = ent.text || ent.string || '';
          const cleanText = cleanCadMText(rawText);
          if (cleanText) {
            const pos = ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
            const h = ent.textHeight || ent.height || 2.5;
            const rot = ent.rotation || 0;
            model.addText(cleanText, { x: pos.x, y: pos.y }, h, rot, layer);
            textCount++;
          }
        }
        // 8. 속성 문자 (ATTRIB)
        else if (ent.type === 'ATTRIB') {
          const tObj = typeof ent.text === 'object' ? ent.text : null;
          const rawText = (tObj ? tObj.text : ent.text) || ent.string || '';
          const cleanText = cleanCadMText(rawText);
          if (cleanText) {
            const pos = (tObj ? tObj.startPoint : null) || ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
            const h = (tObj ? tObj.textHeight : null) || ent.textHeight || ent.height || 2.5;
            const rot = (tObj ? tObj.rotation : null) || ent.rotation || 0;
            model.addText(cleanText, { x: pos.x, y: pos.y }, h, rot, layer);
            textCount++;
          }
        }
        // 9. 점 (POINT)
        else if (ent.type === 'POINT' && ent.position) {
          model.addPoint({ x: ent.position.x, y: ent.position.y }, layer);
          pointCount++;
        }

        // 10. 블록 참조 (INSERT) 내장 속성 문자(attribs) 전개
        if (ent.type === 'INSERT' && Array.isArray(ent.attribs)) {
          for (const att of ent.attribs) {
            const tObj = typeof att.text === 'object' ? att.text : null;
            const rawText = (tObj ? tObj.text : att.text) || att.string || '';
            const cleanText = cleanCadMText(rawText);
            if (cleanText) {
              const pos = (tObj ? tObj.startPoint : null) || att.insertionPoint || att.startPoint || att.position || { x: 0, y: 0 };
              const h = (tObj ? tObj.textHeight : null) || att.textHeight || att.height || 2.5;
              const rot = (tObj ? tObj.rotation : null) || att.rotation || 0;
              const aLayer = att.layer || layer;
              ensureLayer(aLayer);
              model.addText(cleanText, { x: pos.x, y: pos.y }, h, rot, aLayer);
              textCount++;
            }
          }
        }
      }

      return {
        lineCount,
        circleCount,
        polylineCount,
        textCount,
        pointCount,
        versionName: detection.versionName
      };
    } catch (convertErr: any) {
      this.resetInstance();
      throw new Error(this.formatErrorMessage(convertErr, detection));
    } finally {
      if (dwg) {
        try {
          libredwg.dwg_free(dwg);
        } catch (_) {
          this.resetInstance();
        }
      }
    }
  }

  /**
   * C/WebAssembly 에러를 내부 오류 코드로 변환 (사용자에게 노출 안 함)
   */
  private static formatErrorMessage(err: any, detection?: CadFormatDetection): string {
    const rawMsg = String(err?.message || err || '');
    return `DWG_PARSE_FAILED|${rawMsg}`;
  }
}

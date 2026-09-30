import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { DxfParser } from 'dxf-json';
import { cleanCadMText } from './cad-model.ts';

export interface IsolatedParseResult {
  status: 'success' | 'error';
  message?: string;
  totalEntities: number;
  lineCount: number;
  circleCount: number;
  textCount: number;
  hatchCount?: number;
  layers: string[];
  layerColors?: Record<string, string>;
  /** 표시하지 못한(처리 대상이 아닌) 개체 종류별 개수. 비어 있으면 모든 개체를 처리한 것 */
  skippedEntities?: Record<string, number>;
  entities: any[];
  boundingBox: any;
}

const BIN_DIR = path.resolve(process.cwd(), 'bin');
const DWG2DXF_EXE = path.join(BIN_DIR, 'dwg2dxf.exe');
const DXF2DWG_EXE = path.join(BIN_DIR, 'dxf2dwg.exe');
const DWGREWRITE_EXE = path.join(BIN_DIR, 'dwgrewrite.exe');

type Pt = { x: number; y: number };

// AutoCAD ACI(AutoCAD Color Index) 256색 표 (1~255번, 색상당 RRGGBB 6자리)
// 출처: ezdxf(MIT License) DXF_DEFAULT_COLORS - AutoCAD 2020 모델 공간 팔레트(어두운 배경 기준)
const ACI_TABLE =
  'FF0000FFFF0000FF0000FFFF0000FFFF00FFFFFFFF808080C0C0C0FF0000FF7F7FA50000A552527F00007F3F3F' +
  '4C00004C2626260000261313FF3F00FF9F7FA52900A567527F1F007F4F3F4C13004C2F26260900261713FF7F00FFBF7F' +
  'A55200A57C527F3F007F5F3F4C26004C3926261300261C13FFBF00FFDF7FA57C00A591527F5F007F6F3F4C39004C4226' +
  '261C00262113FFFF00FFFF7FA5A500A5A5527F7F007F7F3F4C4C004C4C26262600262613BFFF00DFFF7F7CA50091A552' +
  '5F7F006F7F3F394C00424C261C26002126137FFF00BFFF7F52A5007CA5523F7F005F7F3F264C00394C261326001C2613' +
  '3FFF009FFF7F29A50067A5521F7F004F7F3F134C002F4C2609260017261300FF007FFF7F00A50052A552007F003F7F3F' +
  '004C00264C2600260013261300FF3F7FFF9F00A52952A567007F1F3F7F4F004C13264C2F00260913581700FF7F7FFFBF' +
  '00A55252A57C007F3F3F7F5F004C26264C3900261313581C00FFBF7FFFDF00A57C52A591007F5F3F7F6F004C39264C42' +
  '00261C13585800FFFF7FFFFF00A5A552A5A5007F7F3F7F7F004C4C264C4C00262613585800BFFF7FDFFF007CA55291A5' +
  '005F7F3F6F7F00394C26427E001C26135858007FFF7FBFFF0052A5527CA5003F7F3F5F7F00264C26397E001326131C58' +
  '003FFF7F9FFF0029A55267A5001F7F3F4F7F00134C262F7E0009261317580000FF7F7FFF0000A55252A500007F3F3F7F' +
  '00004C26267E0000261313583F00FF9F7FFF2900A56752A51F007F4F3F7F13004C2F267E0900261713587F00FFBF7FFF' +
  '5200A57C52A53F007F5F3F7F26004C39267E1300261C1358BF00FFDF7FFF7C00A59152A55F007F6F3F7F39004C42264C' +
  '1C0026581358FF00FFFF7FFFA500A5A552A57F007F7F3F7F4C004C4C264C260026581358FF00BFFF7FDFA5007CA55291' +
  '7F005F7F3F6F4C00394C264226001C581358FF007FFF7FBFA50052A5527C7F003F7F3F5F4C00264C263926001358131C' +
  'FF003FFF7F9FA50029A552677F001F7F3F4F4C00134C262F260009581317000000656565666666999999CCCCCCFFFFFF';

/**
 * ACI 번호(1~255)를 #RRGGBB로 변환. 범위 밖(0=ByBlock, 256=ByLayer 등)은 null.
 */
export function aciToHex(index: number): string | null {
  if (!Number.isInteger(index) || index < 1 || index > 255) return null;
  return '#' + ACI_TABLE.substr((index - 1) * 6, 6);
}

const TWO_PI = Math.PI * 2;

/** 호 → 점열 (라디안, a0에서 a1까지 반시계 방향) */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 1e-9) sweep += TWO_PI;
  const segs = Math.max(8, Math.ceil((sweep * 180) / Math.PI / 7.5));
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (sweep * i) / segs;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** 타원(호) → 점열 (라디안, majorEnd는 중심 기준 장축 끝점 벡터) */
function ellipsePoints(c: Pt, majorEnd: Pt, ratio: number, a0: number, a1: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 1e-9) sweep += TWO_PI;
  const segs = Math.max(16, Math.ceil((sweep / TWO_PI) * 64));
  const minor = { x: -majorEnd.y * ratio, y: majorEnd.x * ratio };
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = a0 + (sweep * i) / segs;
    pts.push({
      x: c.x + majorEnd.x * Math.cos(t) + minor.x * Math.sin(t),
      y: c.y + majorEnd.y * Math.cos(t) + minor.y * Math.sin(t)
    });
  }
  return pts;
}

/** bulge가 있는 구간(p1→p2)의 중간점들과 p2를 반환 (p1 제외) */
function bulgePoints(p1: Pt, p2: Pt, bulge: number): Pt[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy);
  if (!bulge || d < 1e-12) return [p2];
  const theta = 4 * Math.atan(bulge); // 부호 있는 포함각
  const half = Math.abs(theta) / 2;
  const r = d / (2 * Math.sin(half));
  const h = r * Math.cos(half); // 대호(θ>π)면 음수가 되어 중심 방향이 자동으로 뒤집힘
  const sgn = bulge > 0 ? 1 : -1;
  const cx = (p1.x + p2.x) / 2 + sgn * (-dy / d) * h;
  const cy = (p1.y + p2.y) / 2 + sgn * (dx / d) * h;
  const a0 = Math.atan2(p1.y - cy, p1.x - cx);
  const segs = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 12)));
  const pts: Pt[] = [];
  for (let i = 1; i < segs; i++) {
    const a = a0 + (theta * i) / segs;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  pts.push(p2);
  return pts;
}

/** 꼭짓점(+bulge) 목록 → 점열. closed면 마지막→처음 구간도 포함하고 시작점으로 닫는다 */
function polylinePoints(vertices: any[], closed: boolean): Pt[] {
  const v = vertices.map(p => ({ x: p.x ?? p.position?.x ?? 0, y: p.y ?? p.position?.y ?? 0, bulge: p.bulge || 0 }));
  const pts: Pt[] = [{ x: v[0].x, y: v[0].y }];
  for (let i = 0; i < v.length - 1; i++) pts.push(...bulgePoints(v[i], v[i + 1], v[i].bulge));
  if (closed && v.length > 2) pts.push(...bulgePoints(v[v.length - 1], v[0], v[v.length - 1].bulge));
  return pts;
}

/** B-스플라인(De Boor) → 점열. 노트/제어점 개수가 맞지 않으면 제어점을 그대로 잇는다 */
function splinePoints(degree: number, knots: number[], ctrl: Pt[], weights?: number[]): Pt[] {
  const n = ctrl.length;
  const p = degree;
  if (!Array.isArray(knots) || knots.length !== n + p + 1 || n <= p) return ctrl.map(c => ({ x: c.x, y: c.y }));

  const samples = Math.min(400, Math.max(32, n * 4));
  const t0 = knots[p];
  const t1 = knots[n];
  const pts: Pt[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples;
    let k = p;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d: number[][] = [];
    for (let j = 0; j <= p; j++) {
      const w = weights?.[j + k - p] ?? 1;
      d.push([ctrl[j + k - p].x * w, ctrl[j + k - p].y * w, w]);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = j + k - p;
        const denom = knots[i + p - r + 1] - knots[i];
        const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;
        for (let c = 0; c < 3; c++) d[j][c] = (1 - alpha) * d[j - 1][c] + alpha * d[j][c];
      }
    }
    const w = d[p][2] || 1;
    pts.push({ x: d[p][0] / w, y: d[p][1] / w });
  }
  return pts;
}

/** 연속 중복점과 (시작점과 같은) 마지막 점을 제거 - 채움 삼각분할 안정화 */
function dedupeLoop(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
  return out;
}

/** HATCH 경계 경로 1개 → 닫힌 다각형 점열 (선/호/타원호/스플라인 모서리 또는 폴리라인 경로) */
function hatchLoopPoints(bp: any): Pt[] {
  if (Array.isArray(bp.vertices) && bp.vertices.length >= 2) {
    return dedupeLoop(polylinePoints(bp.vertices, bp.isClosed !== false));
  }
  const loop: Pt[] = [];
  for (const ed of bp.edges || []) {
    let seg: Pt[] = [];
    if (ed.type === 1 && ed.start && ed.end) {
      seg = [ed.start, ed.end];
    } else if (ed.type === 2 && ed.center && typeof ed.radius === 'number') {
      const s = ed.startAngle || 0;
      const e = ed.endAngle ?? 360;
      // 시계 방향(isCCW=false) 호는 각도가 (360-각도)로 저장되어 있음.
      // 반시계 호 (360-e → 360-s)를 만든 뒤 뒤집어 진행 방향(시작→끝)에 맞춘다.
      seg = ed.isCCW === false
        ? arcPoints(ed.center.x, ed.center.y, ed.radius, ((360 - e) * Math.PI) / 180, ((360 - s) * Math.PI) / 180).reverse()
        : arcPoints(ed.center.x, ed.center.y, ed.radius, (s * Math.PI) / 180, (e * Math.PI) / 180);
    } else if (ed.type === 3 && ed.center && ed.majorAxisEndPoint) {
      // 타원호 모서리: 시계 방향 각도 규칙은 호와 동일하다고 가정 (이 도면에는 없어 미검증)
      const s = ed.startAngle || 0;
      const e = ed.endAngle ?? 360;
      const ratio = ed.axisRatio ?? ed.lengthOfMinorAxis ?? 0.5;
      seg = ed.isCCW === false
        ? ellipsePoints(ed.center, ed.majorAxisEndPoint, ratio, ((360 - e) * Math.PI) / 180, ((360 - s) * Math.PI) / 180).reverse()
        : ellipsePoints(ed.center, ed.majorAxisEndPoint, ratio, (s * Math.PI) / 180, (e * Math.PI) / 180);
    } else if (ed.type === 4 && Array.isArray(ed.controlPoints)) {
      seg = splinePoints(ed.degree ?? 3, ed.knots, ed.controlPoints, ed.weights);
    }
    if (seg.length === 0) continue;
    const last = loop[loop.length - 1];
    // 이전 모서리의 끝점에 뒤쪽 끝이 더 가까우면 방향을 뒤집어 연결
    if (last && Math.hypot(last.x - seg[seg.length - 1].x, last.y - seg[seg.length - 1].y) + 1e-6 < Math.hypot(last.x - seg[0].x, last.y - seg[0].y)) {
      seg = seg.slice().reverse();
    }
    const startIdx = last && Math.hypot(last.x - seg[0].x, last.y - seg[0].y) < 1e-6 ? 1 : 0;
    for (let i = startIdx; i < seg.length; i++) loop.push({ x: seg[i].x, y: seg[i].y });
  }
  return dedupeLoop(loop);
}

// 이 파서가 처리하는 개체 종류. 이 밖의 종류(DIMENSION, SPLINE, LEADER, IMAGE 등)는 표시하지 못하므로
// 조용히 버리지 않고 skippedEntities에 개수를 기록해 화면/CLI에서 알려 준다.
// (ATTDEF는 블록 정의용 태그라 AutoCAD처럼 표시하지 않는 것이 정상, SEQEND는 구조용)
const HANDLED_TYPES = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'HATCH',
  'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'INSERT', 'SEQEND',
  'POINT', 'SOLID', 'SPLINE', 'DIMENSION'
]);

/**
 * DXF 텍스트를 뷰어용 엔티티 목록으로 변환한다 (INSERT 블록 전개, 색·레이어 해석, HATCH/ELLIPSE/MTEXT 처리).
 * 처리하지 못하는 개체 종류는 skippedEntities에 종류별 개수로 기록한다. DXF를 해석할 수 없으면 null.
 */
export function parseDxfText(dxfContent: string): IsolatedParseResult | null {
  // dxf-json: HATCH / ATTRIB / ELLIPSE / MTEXT 정렬 정보까지 읽는 파서
  const parsed: any = new DxfParser().parseSync(dxfContent);

          if (parsed && Array.isArray(parsed.entities)) {
            const entities: any[] = [];
            const layersMap: Record<string, string> = { '0': '#FFFFFF' };
            let nextId = 1;
            let lineCount = 0;
            let circleCount = 0;
            let textCount = 0;
            let hatchCount = 0;
            const skipped: Record<string, number> = {}; // 처리하지 못한 개체 종류별 개수

            // 테이블 레이어 색상 복원 (ACI 256색 표 적용)
            const layerTable = parsed.tables?.LAYER?.entries;
            if (Array.isArray(layerTable)) {
              for (const lObj of layerTable) {
                layersMap[lObj.name] = aciToHex(Math.abs(lObj.colorIndex ?? 7)) || '#FFFFFF';
              }
            }

            type Tf = { x: number; y: number; scaleX: number; scaleY: number; rotationRad: number };
            type Ctx = { layer?: string; byBlockColor?: string };
            const round = (n: number) => Number(n.toFixed(4));

            const blocks = parsed.blocks || {};

            // 개체 색상 해석: 256/미지정=ByLayer, 0=ByBlock(INSERT 색 상속), 그 외=ACI 직접 지정
            const resolveColor = (ent: any, layer: string, ctx?: Ctx): string => {
              const ci = ent.colorIndex;
              if (ci === undefined || ci === null || ci === 256) return layersMap[layer] || '#FFFFFF';
              if (ci === 0) return ctx?.byBlockColor || '#FFFFFF';
              return aciToHex(Math.abs(ci)) || layersMap[layer] || '#FFFFFF';
            };

            const processEntity = (ent: any, transform?: Tf, ctx?: Ctx, depth: number = 0) => {
              if (!HANDLED_TYPES.has(ent.type)) {
                skipped[ent.type] = (skipped[ent.type] || 0) + 1;
                return;
              }
              // 블록 내부 "0" 레이어 개체는 INSERT의 레이어를 상속
              const layer = (!ent.layer || ent.layer === '0') && ctx?.layer ? ctx.layer : (ent.layer || '0');
              if (!layersMap[layer]) {
                layersMap[layer] = '#FFFFFF';
              }
              const entColor = resolveColor(ent, layer, ctx);

              const tf = (pt: { x: number; y: number }): Pt => {
                if (!transform) return { x: pt.x, y: pt.y };
                const sx = pt.x * transform.scaleX;
                const sy = pt.y * transform.scaleY;
                const rx = sx * Math.cos(transform.rotationRad) - sy * Math.sin(transform.rotationRad);
                const ry = sx * Math.sin(transform.rotationRad) + sy * Math.cos(transform.rotationRad);
                return { x: rx + transform.x, y: ry + transform.y };
              };
              const avgScale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
              const rotDegAdd = transform ? (transform.rotationRad * 180) / Math.PI : 0;

              const pushLine = (a: Pt, b: Pt) => {
                const p1 = tf(a);
                const p2 = tf(b);
                entities.push({
                  id: `line_${nextId++}`,
                  type: 'LINE',
                  layer,
                  color: entColor,
                  start: { x: round(p1.x), y: round(p1.y), z: 0 },
                  end: { x: round(p2.x), y: round(p2.y), z: 0 }
                });
                lineCount++;
              };
              const pushChain = (pts: Pt[], closed: boolean) => {
                for (let i = 0; i < pts.length - 1; i++) pushLine(pts[i], pts[i + 1]);
                if (closed && pts.length > 2) pushLine(pts[pts.length - 1], pts[0]);
              };

              // 선분 (LINE)
              if (ent.type === 'LINE' && (ent.startPoint || ent.vertices) && (ent.endPoint || ent.vertices)) {
                pushLine(ent.startPoint || ent.vertices[0], ent.endPoint || ent.vertices[1]);
              }
              // 폴리라인 (LWPOLYLINE / POLYLINE) - bulge(호 구간) 반영
              else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
                const closed = !!((ent.flag ?? 0) & 1) || !!ent.shape || !!ent.closed;
                pushChain(polylinePoints(ent.vertices, closed), false);
              }
              // 원 (CIRCLE)
              else if (ent.type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
                const c = tf(ent.center);
                entities.push({
                  id: `circle_${nextId++}`,
                  type: 'CIRCLE',
                  layer,
                  color: entColor,
                  center: { x: round(c.x), y: round(c.y), z: 0 },
                  radius: round(ent.radius * avgScale)
                });
                circleCount++;
              }
              // 호 (ARC) - 각도는 도(degree)
              else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
                const a0 = ((ent.startAngle || 0) * Math.PI) / 180;
                const a1 = ((ent.endAngle ?? 360) * Math.PI) / 180;
                pushChain(arcPoints(ent.center.x, ent.center.y, ent.radius, a0, a1), false);
              }
              // 타원 (ELLIPSE) - 각도는 라디안
              else if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
                pushChain(
                  ellipsePoints(ent.center, ent.majorAxisEndPoint, ent.axisRatio ?? 0.5, ent.startAngle ?? 0, ent.endAngle ?? Math.PI * 2),
                  false
                );
              }
              // 해치 (HATCH) - 경계 루프를 다각형으로 변환
              else if (ent.type === 'HATCH' && Array.isArray(ent.boundaryPaths)) {
                const loops = ent.boundaryPaths
                  .map((bp: any) => hatchLoopPoints(bp))
                  .filter((l: Pt[]) => l.length >= 3)
                  .map((l: Pt[]) => l.map(p => { const q = tf(p); return { x: round(q.x), y: round(q.y) }; }));
                if (loops.length > 0) {
                  entities.push({
                    id: `hatch_${nextId++}`,
                    type: 'HATCH',
                    layer,
                    color: entColor,
                    solid: !!ent.solidFill,
                    loops
                  });
                  hatchCount++;
                }
              }
              // 텍스트 / MTEXT / ATTRIB (ATTDEF는 블록 정의용 태그이므로 표시하지 않음)
              else if ((ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'ATTRIB') && (ent.text || ent.string)) {
                const raw = (typeof ent.text === 'object' ? ent.text?.text : ent.text) || ent.string || '';
                const cleaned = cleanCadMText(raw);
                if (cleaned) {
                  let pt: Pt = { x: 0, y: 0 };
                  let height: number = 2.5;
                  let rotDeg = 0;
                  let anchor: { x: number; y: number } | undefined;

                  if (ent.type === 'MTEXT') {
                    // 기준점(attachmentPoint) 1~9: 위/중간/아래 × 왼쪽/가운데/오른쪽
                    const ap = ent.attachmentPoint || 1;
                    anchor = { x: [0, 0.5, 1][(ap - 1) % 3], y: [1, 0.5, 0][Math.floor((ap - 1) / 3)] };
                    pt = ent.insertionPoint || pt;
                    height = ent.height || height;
                    rotDeg = ent.direction ? (Math.atan2(ent.direction.y, ent.direction.x) * 180) / Math.PI : (ent.rotation || 0);
                  } else {
                    const hj = ent.halign ?? ent.horizontalJustification ?? 0;
                    const vj = ent.valign ?? ent.verticalJustification ?? 0;
                    height = ent.textHeight || ent.height || height;
                    rotDeg = ent.rotation || 0;
                    if (hj === 0 && vj === 0) {
                      pt = ent.startPoint || pt;
                    } else {
                      // 정렬 지정 문자는 두 번째 정렬점을 기준으로 배치 (Aligned/Fit은 시작점)
                      pt = (hj === 3 || hj === 5 ? ent.startPoint : (ent.endPoint || ent.alignmentPoint || ent.startPoint)) || pt;
                      anchor = { x: [0, 0.5, 1, 0, 0.5, 0][hj] ?? 0, y: hj === 4 ? 0.5 : ([0, 0, 0.5, 1][vj] ?? 0) };
                    }
                  }

                  const pos = tf(pt);
                  const out: any = {
                    id: `text_${nextId++}`,
                    type: 'TEXT',
                    layer,
                    color: entColor,
                    text: cleaned,
                    position: { x: round(pos.x), y: round(pos.y), z: 0 },
                    height: round(height * avgScale),
                    rotation: Number((rotDeg + rotDegAdd).toFixed(2))
                  };
                  if (anchor) out.anchor = anchor;
                  entities.push(out);
                  textCount++;
                }
              }
              // 점 (POINT)
              else if (ent.type === 'POINT' && ent.position) {
                const p = tf(ent.position);
                entities.push({
                  id: `point_${nextId++}`,
                  type: 'POINT',
                  layer,
                  color: entColor,
                  position: { x: round(p.x), y: round(p.y), z: 0 }
                });
              }
              // 솔리드 (SOLID): 채워진 3~4각형. 꼭짓점 순서가 1,2,4,3이므로 다각형 순서로 재배열
              else if (ent.type === 'SOLID' && Array.isArray(ent.points) && ent.points.length >= 3) {
                const order = ent.points.length >= 4 ? [0, 1, 3, 2] : [0, 1, 2];
                const loop = dedupeLoop(order.map(i => tf(ent.points[i])));
                if (loop.length >= 3) {
                  entities.push({
                    id: `hatch_${nextId++}`,
                    type: 'HATCH',
                    layer,
                    color: entColor,
                    solid: true,
                    loops: [loop.map(q => ({ x: round(q.x), y: round(q.y) }))]
                  });
                  hatchCount++;
                }
              }
              // 스플라인 (SPLINE): 제어점이 있으면 B-스플라인 곡선으로, 맞춤점만 있으면 점을 이어서 근사
              else if (ent.type === 'SPLINE' && (ent.controlPoints?.length >= 2 || ent.fitPoints?.length >= 2)) {
                const pts = ent.controlPoints?.length >= 2
                  ? splinePoints(ent.degree ?? 3, ent.knots, ent.controlPoints, ent.weights?.length ? ent.weights : undefined)
                  : ent.fitPoints;
                pushChain(pts, !!((ent.flag ?? 0) & 1));
              }
              // 치수 (DIMENSION): 치수선·화살표·문자가 들어 있는 익명 블록을 펼쳐서 표시
              else if (ent.type === 'DIMENSION') {
                const dimBlock = ent.name ? blocks[ent.name] : undefined;
                if (dimBlock && Array.isArray(dimBlock.entities) && depth < 8) {
                  for (const bEnt of dimBlock.entities) {
                    processEntity(bEnt, transform, { layer, byBlockColor: entColor }, depth + 1);
                  }
                } else {
                  skipped.DIMENSION = (skipped.DIMENSION || 0) + 1; // 그래픽 블록이 없어 표시 불가
                }
              }
              // 블록 참조 (INSERT) 전개
              else if (ent.type === 'INSERT' && ent.name && blocks[ent.name] && depth < 8) {
                const blk = blocks[ent.name];
                const insPos = tf(ent.insertionPoint || ent.position || { x: 0, y: 0 });
                const scaleX = (ent.xScale || 1) * (transform ? transform.scaleX : 1);
                const scaleY = (ent.yScale || 1) * (transform ? transform.scaleY : 1);
                const rotRad = ((ent.rotation || 0) * Math.PI) / 180 + (transform ? transform.rotationRad : 0);

                if (blk.entities && Array.isArray(blk.entities)) {
                  for (const bEnt of blk.entities) {
                    processEntity(
                      bEnt,
                      { x: insPos.x, y: insPos.y, scaleX, scaleY, rotationRad: rotRad },
                      { layer, byBlockColor: entColor },
                      depth + 1
                    );
                  }
                }
              }
            };

            for (const ent of parsed.entities) {
              processEntity(ent);
            }

            // 바운딩 박스 계산
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const e of entities) {
              if (e.type === 'LINE' && e.start && e.end) {
                minX = Math.min(minX, e.start.x, e.end.x);
                minY = Math.min(minY, e.start.y, e.end.y);
                maxX = Math.max(maxX, e.start.x, e.end.x);
                maxY = Math.max(maxY, e.start.y, e.end.y);
              } else if (e.type === 'CIRCLE' && e.center && e.radius) {
                minX = Math.min(minX, e.center.x - e.radius);
                minY = Math.min(minY, e.center.y - e.radius);
                maxX = Math.max(maxX, e.center.x + e.radius);
                maxY = Math.max(maxY, e.center.y + e.radius);
              } else if (e.type === 'TEXT' && e.position) {
                const h = e.height || 2.5;
                const w = (e.text?.length || 1) * h * 0.7;
                minX = Math.min(minX, e.position.x);
                minY = Math.min(minY, e.position.y);
                maxX = Math.max(maxX, e.position.x + w);
                maxY = Math.max(maxY, e.position.y + h);
              } else if (e.type === 'POINT' && e.position) {
                minX = Math.min(minX, e.position.x);
                minY = Math.min(minY, e.position.y);
                maxX = Math.max(maxX, e.position.x);
                maxY = Math.max(maxY, e.position.y);
              } else if (e.type === 'HATCH' && Array.isArray(e.loops)) {
                for (const loop of e.loops) {
                  for (const p of loop) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                  }
                }
              }
            }

            const boundingBox = (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) ? {
              minX: Number(minX.toFixed(4)),
              minY: Number(minY.toFixed(4)),
              maxX: Number(maxX.toFixed(4)),
              maxY: Number(maxY.toFixed(4)),
              width: Number((maxX - minX).toFixed(4)),
              height: Number((maxY - minY).toFixed(4)),
              centerX: Number(((minX + maxX) / 2).toFixed(4)),
              centerY: Number(((minY + maxY) / 2).toFixed(4))
            } : null;

            return {
              status: 'success',
              totalEntities: entities.length,
              lineCount,
              circleCount,
              textCount,
              hatchCount,
              layers: Object.keys(layersMap),
              layerColors: layersMap,
              skippedEntities: skipped,
              entities,
              boundingBox
            };
          }
  return null;
}

/**
 * DWG 바이너리를 받아 블록 전개(표제란, 테두리 틀 포함)까지 마친 엔티티를 파싱
 */
export function parseDwgIsolated(
  buffer: Buffer | ArrayBuffer,
  // cliFallback=false: 변환 실패 시 CLI(agent-cli.js)를 다시 호출하지 않고 오류로 종료
  // (CLI가 이 함수를 호출하는 경우 무한 재귀를 막기 위해 사용)
  options: { cliFallback?: boolean } = {}
): IsolatedParseResult {
  const tempDir = path.resolve(process.cwd(), '.cad_temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const prefix = `cad_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempDwgPath = path.join(tempDir, `${prefix}.dwg`);
  const tempDxfPath = path.join(tempDir, `${prefix}.dxf`);
  const nodeBuf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  fs.writeFileSync(tempDwgPath, nodeBuf);
  const currentSourceDwg = path.join(tempDir, '.current_source.dwg');
  try { fs.copyFileSync(tempDwgPath, currentSourceDwg); } catch (_) {}

  try {
    // 1단계: bin/dwg2dxf.exe를 사용하여 모든 블록과 표제란을 완전체로 전개한 DXF 추출
    if (fs.existsSync(DWG2DXF_EXE)) {
      try {
        execFileSync(DWG2DXF_EXE, ['-v0', tempDwgPath, '-o', tempDxfPath], {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 100 * 1024 * 1024
        });

        if (fs.existsSync(tempDxfPath) && fs.statSync(tempDxfPath).size > 0) {
          // 현재 도면의 원본 DXF 캐싱 (DWG 저장 시 기준 도면으로 사용)
          const currentBaseDxfPath = path.join(tempDir, '.current_base.dxf');
          try { fs.copyFileSync(tempDxfPath, currentBaseDxfPath); } catch (_) {}

          const dxfContent = fs.readFileSync(tempDxfPath, 'utf-8');
          const result = parseDxfText(dxfContent);
          if (result) return result;
        }
      } catch (fullDxfErr) {
        console.warn('dwg2dxf full conversion warning:', fullDxfErr);
      }
    }

    if (options.cliFallback === false) {
      throw new Error('dwg2dxf 변환에 실패했습니다 (CLI 폴백 비활성).');
    }

    // 2단계 폴백: CLI 기반 파싱
    const cliPath = path.resolve(process.cwd(), 'src/agent-cli.js');
    execFileSync('node', [cliPath, 'open', tempDwgPath], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024
    });

    const stateFile = path.resolve(process.cwd(), '.cad_agent_state.json');
    let allEntities: any[] = [];
    let layers: string[] = ['0'];
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        allEntities = state.entities || [];
        layers = Object.keys(state.layers || {});
      } catch (_) {}
    }

    const inspectRaw = execFileSync('node', [cliPath, 'inspect'], { encoding: 'utf-8' });
    const inspectData = JSON.parse(inspectRaw);

    return {
      status: 'success',
      totalEntities: allEntities.length,
      lineCount: allEntities.filter(e => e.type === 'LINE').length,
      circleCount: allEntities.filter(e => e.type === 'CIRCLE').length,
      textCount: allEntities.filter(e => e.type === 'TEXT').length,
      layers,
      entities: allEntities,
      boundingBox: inspectData.boundingBox
    };
  } finally {
    if (fs.existsSync(tempDwgPath)) try { fs.unlinkSync(tempDwgPath); } catch (_) {}
    if (fs.existsSync(tempDxfPath)) try { fs.unlinkSync(tempDxfPath); } catch (_) {}
  }
}

/**
 * DWG 생성 방식
 * - 'rewrite-original': 열어 둔 원본 DWG를 LibreDWG로 다시 쓴 파일 (열기 이후의 편집은 반영되지 않음)
 * - 'dxf2dwg': 전달받은 DXF를 LibreDWG로 변환한 파일 (편집 반영)
 */
export type DwgExportMode = 'rewrite-original' | 'dxf2dwg';

/**
 * 도면 DXF 문자열을 받아 DWG 파일 버퍼로 변환 생성 (생성 방식 정보 없이 버퍼만 반환)
 */
export function convertDxfToDwgBinary(dxfContent: string): Buffer {
  return convertDxfToDwgWithInfo(dxfContent).buffer;
}

/**
 * 도면 DXF 문자열을 DWG로 변환하고, 어떤 방식으로 만들었는지(mode)도 함께 반환한다.
 * 변환에 실패하면 (다른 파일을 대신 돌려주지 않고) 오류를 던진다.
 */
export function convertDxfToDwgWithInfo(dxfContent: string): { buffer: Buffer; mode: DwgExportMode } {
  const tempDir = path.resolve(process.cwd(), '.cad_temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const prefix = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempDxfPath = path.join(tempDir, `${prefix}.dxf`);
  const tempDwgPath = path.join(tempDir, `${prefix}.dwg`);

  // 1순위: 원본 DWG 파일이 존재하는 경우 dwgrewrite로 다시 씀 (AC1015 바이너리, 열기 이후의 편집은 반영되지 않음)
  const currentSourceDwg = path.join(tempDir, '.current_source.dwg');
  if (fs.existsSync(DWGREWRITE_EXE) && fs.existsSync(currentSourceDwg)) {
    try {
      execFileSync(DWGREWRITE_EXE, ['-v0', currentSourceDwg, tempDwgPath], { encoding: 'utf-8', timeout: 30000 });
      if (fs.existsSync(tempDwgPath) && fs.statSync(tempDwgPath).size > 0) {
        return { buffer: fs.readFileSync(tempDwgPath), mode: 'rewrite-original' };
      }
    } catch (_) {}
  }

  // 표준 딕셔너리 테이블 포함 여부 판별 (단순 dxf-writer 출력인지 확인)
  let finalDxf = dxfContent;
  const isSimplifiedDxf = !dxfContent.includes('DICTIONARY') || !dxfContent.includes('ACAD_GROUP');
  if (isSimplifiedDxf) {
    const currentBaseDxf = path.join(tempDir, '.current_base.dxf');
    const templateDxf = path.resolve(process.cwd(), 'src/templates/acad_template.dxf');
    const baseSource = fs.existsSync(currentBaseDxf) ? currentBaseDxf : (fs.existsSync(templateDxf) ? templateDxf : null);

    if (baseSource) {
      try {
        const tmplContent = fs.readFileSync(baseSource, 'utf-8');
        const entitiesPos = tmplContent.indexOf('ENTITIES\r\n');
        const endsecPos = tmplContent.indexOf('\r\n  0\r\nENDSEC', entitiesPos);
        if (entitiesPos !== -1 && endsecPos !== -1) {
          const headerPart = tmplContent.substring(0, entitiesPos + 'ENTITIES\r\n'.length);
          const objectsPart = tmplContent.substring(endsecPos);

          const sPos = dxfContent.indexOf('ENTITIES\n') !== -1 ? dxfContent.indexOf('ENTITIES\n') + 9 : (dxfContent.indexOf('ENTITIES\r\n') !== -1 ? dxfContent.indexOf('ENTITIES\r\n') + 10 : 0);
          const sEnd = dxfContent.indexOf('\n0\nENDSEC', sPos) !== -1 ? dxfContent.indexOf('\n0\nENDSEC', sPos) : (dxfContent.indexOf('\r\n  0\r\nENDSEC', sPos) !== -1 ? dxfContent.indexOf('\r\n  0\r\nENDSEC', sPos) : dxfContent.length);

          const entText = dxfContent.substring(sPos, sEnd).replace(/\r?\n/g, '\r\n');
          finalDxf = headerPart + entText + objectsPart;
        }
      } catch (tmplErr) {
        console.warn('DXF template merge notice:', tmplErr);
      }
    }
  }

  fs.writeFileSync(tempDxfPath, finalDxf, 'utf-8');

  try {
    if (fs.existsSync(DXF2DWG_EXE)) {
      try {
        execFileSync(DXF2DWG_EXE, ['-y', '-v0', tempDxfPath, '-o', tempDwgPath], {
          encoding: 'utf-8',
          timeout: 30000
        });
        if (fs.existsSync(tempDwgPath) && fs.statSync(tempDwgPath).size > 0) {
          return { buffer: fs.readFileSync(tempDwgPath), mode: 'dxf2dwg' };
        }
      } catch (convErr) {
        console.warn('dxf2dwg direct conversion notice:', convErr);
      }
    }

    // 예전에는 여기서 샘플 도면(samples/MAIN_COM_01.dwg)을 대신 돌려주었으나,
    // 사용자의 도면이 아닌 파일이 저장 결과로 전달되는 문제가 있어 오류로 처리한다.
    throw new Error('DWG 변환에 실패했습니다. DXF로 저장해 주세요. (DXF→DWG 변환기가 도면을 읽지 못했거나 찾을 수 없습니다.)');
  } finally {
    if (fs.existsSync(tempDxfPath)) try { fs.unlinkSync(tempDxfPath); } catch (_) {}
    if (fs.existsSync(tempDwgPath)) try { fs.unlinkSync(tempDwgPath); } catch (_) {}
  }
}

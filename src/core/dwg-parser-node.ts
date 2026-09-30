import path from 'path';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { cleanCadMText } from './cad-model.ts';

let cachedLibreDwg: LibreDwg | null = null;

async function getLibreDwgNode(): Promise<LibreDwg> {
  if (!cachedLibreDwg) {
    const wasmPath = path.resolve(process.cwd(), 'node_modules/@mlightcad/libredwg-web/wasm');
    cachedLibreDwg = await LibreDwg.create(wasmPath);
  }
  return cachedLibreDwg;
}

export interface ParsedEntityData {
  id: string;
  type: 'LINE' | 'CIRCLE' | 'TEXT' | 'POINT';
  layer: string;
  color?: string;
  start?: { x: number; y: number; z?: number };
  end?: { x: number; y: number; z?: number };
  center?: { x: number; y: number; z?: number };
  radius?: number;
  text?: string;
  position?: { x: number; y: number; z?: number };
  height?: number;
  rotation?: number;
}

export interface DwgParseResult {
  status: 'success' | 'error';
  totalEntities: number;
  lineCount: number;
  circleCount: number;
  textCount: number;
  layers: string[];
  entities: ParsedEntityData[];
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  } | null;
}

export async function parseDwgBinary(buffer: Buffer | ArrayBuffer): Promise<DwgParseResult> {
  const libredwg = await getLibreDwgNode();
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let dwg: any = null;
  try {
    dwg = libredwg.dwg_read_data(uint8, Dwg_File_Type.DWG);
    if (!dwg) throw new Error('dwg_read_data returned null');

    const db = libredwg.convert(dwg);
    if (!db) throw new Error('DWG database convert failed');

    const entities: ParsedEntityData[] = [];
    const layersSet = new Set<string>(['0']);
    let nextId = 1;
    let lineCount = 0;
    let circleCount = 0;
    let textCount = 0;

    const rawEntities: any[] = [];
    if (Array.isArray(db.entities)) rawEntities.push(...db.entities);
    if (db.blocks) {
      for (const bk of Object.keys(db.blocks)) {
        if (Array.isArray(db.blocks[bk]?.entities)) {
          rawEntities.push(...db.blocks[bk].entities);
        }
      }
    }

    for (const ent of rawEntities) {
      const layer = ent.layer || '0';
      layersSet.add(layer);

      // 1. 선분 (LINE)
      const start = ent.startPoint || ent.start || (ent.vertices && ent.vertices[0]);
      const end = ent.endPoint || ent.end || (ent.vertices && ent.vertices[1]);
      if (ent.type === 'LINE' && start && end) {
        entities.push({
          id: `line_${nextId++}`,
          type: 'LINE',
          layer,
          start: { x: Number(start.x.toFixed(4)), y: Number(start.y.toFixed(4)), z: 0 },
          end: { x: Number(end.x.toFixed(4)), y: Number(end.y.toFixed(4)), z: 0 }
        });
        lineCount++;
      }
      // 2. 원 (CIRCLE)
      else if (ent.type === 'CIRCLE' && (ent.center || ent.centerPoint) && typeof (ent.radius || ent.r) === 'number') {
        const c = ent.center || ent.centerPoint;
        const r = ent.radius || ent.r;
        entities.push({
          id: `circle_${nextId++}`,
          type: 'CIRCLE',
          layer,
          center: { x: Number(c.x.toFixed(4)), y: Number(c.y.toFixed(4)), z: 0 },
          radius: Number(r.toFixed(4))
        });
        circleCount++;
      }
      // 3. 폴리라인 (LWPOLYLINE / POLYLINE)
      else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
        const pts = ent.vertices;
        for (let i = 0; i < pts.length - 1; i++) {
          entities.push({
            id: `line_${nextId++}`,
            type: 'LINE',
            layer,
            start: { x: Number(pts[i].x.toFixed(4)), y: Number(pts[i].y.toFixed(4)), z: 0 },
            end: { x: Number(pts[i + 1].x.toFixed(4)), y: Number(pts[i + 1].y.toFixed(4)), z: 0 }
          });
          lineCount++;
        }
        if ((ent.shape || ent.closed) && pts.length > 2) {
          entities.push({
            id: `line_${nextId++}`,
            type: 'LINE',
            layer,
            start: { x: Number(pts[pts.length - 1].x.toFixed(4)), y: Number(pts[pts.length - 1].y.toFixed(4)), z: 0 },
            end: { x: Number(pts[0].x.toFixed(4)), y: Number(pts[0].y.toFixed(4)), z: 0 }
          });
          lineCount++;
        }
      }
      // 4. 호 (ARC)
      else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
        const startAngle = ent.startAngle || 0;
        const endAngle = ent.endAngle || Math.PI * 2;
        const segs = 16;
        let diff = endAngle - startAngle;
        if (diff < 0) diff += Math.PI * 2;
        const step = diff / segs;
        let prevX = ent.center.x + Math.cos(startAngle) * ent.radius;
        let prevY = ent.center.y + Math.sin(startAngle) * ent.radius;
        for (let s = 1; s <= segs; s++) {
          const ang = startAngle + step * s;
          const curX = ent.center.x + Math.cos(ang) * ent.radius;
          const curY = ent.center.y + Math.sin(ang) * ent.radius;
          entities.push({
            id: `line_${nextId++}`,
            type: 'LINE',
            layer,
            start: { x: Number(prevX.toFixed(4)), y: Number(prevY.toFixed(4)), z: 0 },
            end: { x: Number(curX.toFixed(4)), y: Number(curY.toFixed(4)), z: 0 }
          });
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
          entities.push({
            id: `line_${nextId++}`,
            type: 'LINE',
            layer,
            start: { x: Number(prevX.toFixed(4)), y: Number(prevY.toFixed(4)), z: 0 },
            end: { x: Number(curX.toFixed(4)), y: Number(curY.toFixed(4)), z: 0 }
          });
          lineCount++;
          prevX = curX;
          prevY = curY;
        }
      }
      // 6. 해치 (HATCH)
      else if (ent.type === 'HATCH' && Array.isArray(ent.boundaryPaths)) {
        for (const bp of ent.boundaryPaths) {
          for (const edge of bp.edges || []) {
            if (edge.type === 2 && edge.center && typeof edge.radius === 'number') {
              entities.push({
                id: `circle_${nextId++}`,
                type: 'CIRCLE',
                layer,
                center: { x: Number(edge.center.x.toFixed(4)), y: Number(edge.center.y.toFixed(4)), z: 0 },
                radius: Number(edge.radius.toFixed(4))
              });
              circleCount++;
            } else if (edge.type === 1 && edge.start && edge.end) {
              entities.push({
                id: `line_${nextId++}`,
                type: 'LINE',
                layer,
                start: { x: Number(edge.start.x.toFixed(4)), y: Number(edge.start.y.toFixed(4)), z: 0 },
                end: { x: Number(edge.end.x.toFixed(4)), y: Number(edge.end.y.toFixed(4)), z: 0 }
              });
              lineCount++;
            }
          }
        }
      }
      // 7. 텍스트 (TEXT / MTEXT)
      else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && (ent.text || ent.string)) {
        const cleaned = cleanCadMText(ent.text || ent.string || '');
        if (cleaned) {
          const pos = ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
          entities.push({
            id: `text_${nextId++}`,
            type: 'TEXT',
            layer,
            text: cleaned,
            position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)), z: 0 },
            height: Number((ent.textHeight || ent.height || 2.5).toFixed(4)),
            rotation: Number((ent.rotation || 0).toFixed(2))
          });
          textCount++;
        }
      }
      // 8. 속성 문자 (ATTRIB)
      else if (ent.type === 'ATTRIB') {
        const tObj = typeof ent.text === 'object' ? ent.text : null;
        const cleaned = cleanCadMText((tObj ? tObj.text : ent.text) || ent.string || '');
        if (cleaned) {
          const pos = (tObj ? tObj.startPoint : null) || ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
          entities.push({
            id: `text_${nextId++}`,
            type: 'TEXT',
            layer,
            text: cleaned,
            position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)), z: 0 },
            height: Number(((tObj ? tObj.textHeight : null) || ent.textHeight || 2.5).toFixed(4)),
            rotation: Number(((tObj ? tObj.rotation : null) || ent.rotation || 0).toFixed(2))
          });
          textCount++;
        }
      }
      // 9. 점 (POINT)
      else if (ent.type === 'POINT' && ent.position) {
        entities.push({
          id: `point_${nextId++}`,
          type: 'POINT',
          layer,
          position: { x: Number(ent.position.x.toFixed(4)), y: Number(ent.position.y.toFixed(4)), z: 0 }
        });
      }

      // 10. 블록 참조 (INSERT) 내장 속성
      if (ent.type === 'INSERT' && Array.isArray(ent.attribs)) {
        for (const att of ent.attribs) {
          const tObj = typeof att.text === 'object' ? att.text : null;
          const cleaned = cleanCadMText((tObj ? tObj.text : att.text) || att.string || '');
          if (cleaned) {
            const pos = (tObj ? tObj.startPoint : null) || att.insertionPoint || att.startPoint || att.position || { x: 0, y: 0 };
            const aLayer = att.layer || layer;
            layersSet.add(aLayer);
            entities.push({
              id: `text_${nextId++}`,
              type: 'TEXT',
              layer: aLayer,
              text: cleaned,
              position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)), z: 0 },
              height: Number(((tObj ? tObj.textHeight : null) || att.textHeight || 2.5).toFixed(4)),
              rotation: Number(((tObj ? tObj.rotation : null) || att.rotation || 0).toFixed(2))
            });
            textCount++;
          }
        }
      }
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
      layers: Array.from(layersSet),
      entities,
      boundingBox
    };
  } finally {
    if (dwg) {
      try { libredwg.dwg_free(dwg); } catch (_) {}
    }
  }
}

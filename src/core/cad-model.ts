import Drawing from 'dxf-writer';
import DxfParser from 'dxf-parser';
import { shapeCount, applyEntityColor, hexToTrueColor } from './dxf-entity-color.ts';
import type { LiteDecoded, LiteHeader } from './cadlite.ts';

/**
 * AutoCAD MTEXT 서식 제어 문자열을 순수 텍스트로 정제
 */
export function cleanCadMText(raw: string | any): string {
  if (!raw) return '';
  let s = String(raw);

  // 0. 유니코드 이스케이프 \U+XXXX (구버전 DXF의 한글 등) 와 CAD 특수 기호 %%d(°) %%p(±) %%c(Ø)
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø');

  // 1. 분수 / 스택: \S a^b; -> a/b
  s = s.replace(/\\S([^;^]+)\^([^;]*);/gi, '$1/$2');

  // 2. 폰트/스타일: \f...; 또는 \F...;
  s = s.replace(/\\[fF][^;]*;/g, '');

  // 3. 색상/높이/폭/기울기/정렬/트래킹 등 속성 코드: \C...;, \H...;, \W...;, \Q...;, \A...;, \T...;
  s = s.replace(/\\[cChHwWqQaAtT][^;]*;/g, '');

  // 4. 단락 줄바꿈: \P, \p -> 줄바꿈 공백
  s = s.replace(/\\[pP]/g, ' ');

  // 5. 밑줄/취소선 등 토글 플래그: \L, \l, \O, \o, \K, \k
  s = s.replace(/\\[lLrRoOkK]/g, '');

  // 6. 특수 공백: \~ -> 공백
  s = s.replace(/\\~/g, ' ');

  // 7. 이스케이프 중괄호: \{ -> {, \} -> }
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');

  // 8. 서식 그룹용 중괄호 제거: { 및 }
  s = s.replace(/[{}]/g, '');

  // 9. 이중 백슬래시 축소: \\ -> \
  s = s.replace(/\\\\/g, '\\');

  return s.trim();
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z?: number;
}

export interface BaseEntity {
  id: string;
  type: 'LINE' | 'CIRCLE' | 'TEXT' | 'POINT' | 'ARC' | 'POLYLINE' | 'HATCH';
  layer: string;
  color?: string;
  lineweight?: number;
  linetype?: string;
  transparency?: number;
}

export interface LineEntity extends BaseEntity {
  type: 'LINE';
  start: Point3D;
  end: Point3D;
}

export interface CircleEntity extends BaseEntity {
  type: 'CIRCLE';
  center: Point3D;
  radius: number;
}

export interface TextEntity extends BaseEntity {
  type: 'TEXT';
  text: string;
  position: Point3D;
  height: number;
  rotation: number;
  /** 문자 기준점 (0~1): x 0=왼쪽/0.5=가운데/1=오른쪽, y 0=아래/0.5=중간/1=위. 미지정이면 왼쪽 중간 */
  anchor?: { x: number; y: number };
}

export interface PointEntity extends BaseEntity {
  type: 'POINT';
  position: Point3D;
}

export interface ArcEntity extends BaseEntity {
  type: 'ARC';
  center: Point3D;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface PolylineEntity extends BaseEntity {
  type: 'POLYLINE';
  vertices: Point3D[];
  closed: boolean;
}

/** 채움(HATCH): 경계 루프 다각형들. loops[0]이 바깥 경계, 나머지는 구멍으로 취급 */
export interface HatchEntity extends BaseEntity {
  type: 'HATCH';
  loops: Point2D[][];
  solid: boolean;
}

export type CadEntity = LineEntity | CircleEntity | TextEntity | PointEntity | ArcEntity | PolylineEntity | HatchEntity;

export interface LayerInfo {
  name: string;
  color: string;
  visible: boolean;
}

export interface MeasureResult {
  p1: Point2D;
  p2: Point2D;
  distance: number;
  deltaX: number;
  deltaY: number;
  angleDeg: number;
}

export interface AreaResult {
  points: Point2D[];
  areaMm2: number;
  areaM2: number;
  perimeterMm: number;
}

export interface CircleMeasureResult {
  center: Point2D;
  radius: number;
  diameter: number;
  circumference: number;
  areaMm2: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

// AutoCAD ACI 표준 색상 매핑 테이블
const ACI_COLOR_MAP: { [key: number]: string } = {
  1: '#FF0000', // Red
  2: '#FFFF00', // Yellow
  3: '#00FF00', // Green
  4: '#00FFFF', // Cyan
  5: '#0000FF', // Blue
  6: '#FF00FF', // Magenta
  7: '#FFFFFF', // White / Black
  8: '#808080', // Dark Gray
  9: '#C0C0C0'  // Light Gray
};

interface UndoRedoState {
  entities: Map<string, CadEntity>;
  nextId: number;
}

/**
 * 대용량 도면의 선분 묶음 (읽기 전용 배경). 개체 객체로 만들지 않고 (레이어, 색)별 좌표 배열로만 들고 있어
 * 수백만 개의 선분도 화면에 그릴 수 있다. 선택·이동·스냅 대상은 아니다.
 * positions: [x1,y1,x2,y2,...] Float32 (origin 기준 상대 좌표)
 */
export interface StaticLineBatch {
  layer: string;
  color: string;
  count: number;
  positions: Float32Array;
}

export class CadModel {
  private entities: Map<string, CadEntity> = new Map();
  private staticBatches: StaticLineBatch[] = [];
  private staticOrigin: Point2D = { x: 0, y: 0 };
  private staticBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private layers: Map<string, LayerInfo> = new Map();
  private activeLayerName: string = '0';
  private nextId: number = 1;
  private selectedIds: Set<string> = new Set();
  private clipboard: CadEntity[] = [];
  private undoStack: UndoRedoState[] = [];
  private redoStack: UndoRedoState[] = [];
  private maxHistorySize: number = 100;

  constructor() {
    this.resetLayers(true);
  }

  /**
   * 레이어 목록 초기화. 파일을 열 때는 기본값(샘플 레이어 미포함)으로 호출해 '0' 레이어만 남기고,
   * 이후 파일의 레이어가 등록되게 한다. withSampleLayers=true면 샘플 도면용 기본 레이어를 함께 만든다.
   */
  public resetLayers(withSampleLayers: boolean = false) {
    this.layers.clear();
    this.addLayer('0', '#FFFFFF');
    if (withSampleLayers) {
      this.addLayer('WALL', '#00FFFF');
      this.addLayer('COLUMN', '#FF5555');
      this.addLayer('DIMENSION', '#3FB950');
      this.addLayer('TEXT', '#F0883E');
    }
    this.activeLayerName = '0';
  }

  private saveState() {
    const state: UndoRedoState = {
      entities: new Map(this.entities),
      nextId: this.nextId
    };
    this.undoStack.push(state);
    this.redoStack = [];
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const state: UndoRedoState = {
      entities: new Map(this.entities),
      nextId: this.nextId
    };
    this.redoStack.push(state);
    const prevState = this.undoStack.pop()!;
    this.entities = new Map(prevState.entities);
    this.nextId = prevState.nextId;
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const state: UndoRedoState = {
      entities: new Map(this.entities),
      nextId: this.nextId
    };
    this.undoStack.push(state);
    const nextState = this.redoStack.pop()!;
    this.entities = new Map(nextState.entities);
    this.nextId = nextState.nextId;
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public selectEntity(id: string) {
    this.selectedIds.add(id);
  }

  public deselectEntity(id: string) {
    this.selectedIds.delete(id);
  }

  public clearSelection() {
    this.selectedIds.clear();
  }

  public getSelectedIds(): Set<string> {
    return new Set(this.selectedIds);
  }

  public getSelectedEntities(): CadEntity[] {
    return Array.from(this.selectedIds)
      .map(id => this.entities.get(id))
      .filter(e => e !== undefined) as CadEntity[];
  }

  public isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  public getEntity(id: string): CadEntity | undefined {
    return this.entities.get(id);
  }

  public copy() {
    this.clipboard = this.getSelectedEntities().map(e => JSON.parse(JSON.stringify(e)));
  }

  public paste(offsetX: number = 10, offsetY: number = 10): string[] {
    this.saveState();
    const pastedIds: string[] = [];
    const idMap = new Map<string, string>();

    for (const clipped of this.clipboard) {
      const oldId = clipped.id;
      const newId = `${clipped.type.toLowerCase()}_${this.nextId++}`;
      idMap.set(oldId, newId);

      const newEntity = JSON.parse(JSON.stringify(clipped)) as CadEntity;
      newEntity.id = newId;

      if (newEntity.type === 'LINE') {
        const line = newEntity as LineEntity;
        line.start.x += offsetX;
        line.start.y += offsetY;
        line.end.x += offsetX;
        line.end.y += offsetY;
      } else if (newEntity.type === 'CIRCLE') {
        const circle = newEntity as CircleEntity;
        circle.center.x += offsetX;
        circle.center.y += offsetY;
      } else if (newEntity.type === 'TEXT') {
        const text = newEntity as TextEntity;
        text.position.x += offsetX;
        text.position.y += offsetY;
      } else if (newEntity.type === 'POINT') {
        const point = newEntity as PointEntity;
        point.position.x += offsetX;
        point.position.y += offsetY;
      } else if (newEntity.type === 'HATCH') {
        for (const loop of (newEntity as HatchEntity).loops) {
          for (const p of loop) {
            p.x += offsetX;
            p.y += offsetY;
          }
        }
      }

      this.entities.set(newId, newEntity);
      pastedIds.push(newId);
    }

    return pastedIds;
  }

  public deleteSelected(): boolean {
    if (this.selectedIds.size === 0) return false;
    this.saveState();
    let deleted = false;
    for (const id of this.selectedIds) {
      if (this.entities.delete(id)) {
        deleted = true;
      }
    }
    this.selectedIds.clear();
    return deleted;
  }

  public moveSelected(deltaX: number, deltaY: number): boolean {
    if (this.selectedIds.size === 0) return false;
    this.saveState();
    for (const id of this.selectedIds) {
      const ent = this.entities.get(id);
      if (!ent) continue;

      if (ent.type === 'LINE') {
        const line = ent as LineEntity;
        line.start.x += deltaX;
        line.start.y += deltaY;
        line.end.x += deltaX;
        line.end.y += deltaY;
      } else if (ent.type === 'CIRCLE') {
        const circle = ent as CircleEntity;
        circle.center.x += deltaX;
        circle.center.y += deltaY;
      } else if (ent.type === 'TEXT') {
        const text = ent as TextEntity;
        text.position.x += deltaX;
        text.position.y += deltaY;
      } else if (ent.type === 'POINT') {
        const point = ent as PointEntity;
        point.position.x += deltaX;
        point.position.y += deltaY;
      } else if (ent.type === 'HATCH') {
        for (const loop of (ent as HatchEntity).loops) {
          for (const p of loop) {
            p.x += deltaX;
            p.y += deltaY;
          }
        }
      }
    }
    return true;
  }

  public getEntities(): CadEntity[] {
    return Array.from(this.entities.values());
  }

  public getLayers(): LayerInfo[] {
    return Array.from(this.layers.values());
  }

  public getActiveLayer(): string {
    return this.activeLayerName;
  }

  public setActiveLayer(layerName: string) {
    if (!this.layers.has(layerName)) {
      this.addLayer(layerName, '#FFFFFF');
    }
    this.activeLayerName = layerName;
  }

  public addLayer(name: string, color: string = '#FFFFFF'): LayerInfo {
    const existing = this.layers.get(name);
    if (existing) return existing;
    const newLayer: LayerInfo = { name, color, visible: true };
    this.layers.set(name, newLayer);
    return newLayer;
  }

  public toggleLayerVisibility(name: string) {
    const layer = this.layers.get(name);
    if (layer) {
      layer.visible = !layer.visible;
    }
  }

  public addLine(start: Point2D, end: Point2D, layer: string = this.activeLayerName, color?: string): LineEntity {
    const id = `line_${this.nextId++}`;
    const line: LineEntity = {
      id,
      type: 'LINE',
      layer,
      start: { x: start.x, y: start.y, z: 0 },
      end: { x: end.x, y: end.y, z: 0 },
      color: color || this.layers.get(layer)?.color || '#FFFFFF'
    };
    this.entities.set(id, line);
    return line;
  }

  public addCircle(center: Point2D, radius: number, layer: string = this.activeLayerName, color?: string): CircleEntity {
    const id = `circle_${this.nextId++}`;
    const circle: CircleEntity = {
      id,
      type: 'CIRCLE',
      layer,
      center: { x: center.x, y: center.y, z: 0 },
      radius: Math.abs(radius),
      color: color || this.layers.get(layer)?.color || '#FFFFFF'
    };
    this.entities.set(id, circle);
    return circle;
  }

  public addText(text: string, position: Point2D, height: number = 2.5, rotation: number = 0, layer: string = this.activeLayerName, color?: string, anchor?: { x: number; y: number }): TextEntity {
    const id = `text_${this.nextId++}`;
    const txt: TextEntity = {
      id,
      type: 'TEXT',
      text,
      layer,
      position: { x: position.x, y: position.y, z: 0 },
      height: Math.max(height, 0.5),
      rotation,
      color: color || this.layers.get(layer)?.color || '#F0883E'
    };
    if (anchor) txt.anchor = anchor;
    this.entities.set(id, txt);
    return txt;
  }

  public addHatch(loops: Point2D[][], solid: boolean = true, layer: string = this.activeLayerName, color?: string): HatchEntity {
    const id = `hatch_${this.nextId++}`;
    const hatch: HatchEntity = {
      id,
      type: 'HATCH',
      layer,
      loops: loops.map(l => l.map(p => ({ x: p.x, y: p.y }))),
      solid,
      color: color || this.layers.get(layer)?.color || '#FFFFFF'
    };
    this.entities.set(id, hatch);
    return hatch;
  }

  public addPoint(position: Point2D, layer: string = this.activeLayerName, color?: string): PointEntity {
    const id = `point_${this.nextId++}`;
    const pt: PointEntity = {
      id,
      type: 'POINT',
      layer,
      position: { x: position.x, y: position.y, z: 0 },
      color: color || this.layers.get(layer)?.color || '#58A6FF'
    };
    this.entities.set(id, pt);
    return pt;
  }

  public addArc(center: Point2D, radius: number, startAngle: number, endAngle: number, layer: string = this.activeLayerName, color?: string): ArcEntity {
    const id = `arc_${this.nextId++}`;
    const arc: ArcEntity = {
      id,
      type: 'ARC',
      layer,
      center: { x: center.x, y: center.y, z: 0 },
      radius: Math.abs(radius),
      startAngle,
      endAngle,
      color: color || this.layers.get(layer)?.color || '#FFFFFF'
    };
    this.entities.set(id, arc);
    return arc;
  }

  public addPolyline(vertices: Point2D[], closed: boolean = false, layer: string = this.activeLayerName, color?: string): PolylineEntity {
    const id = `polyline_${this.nextId++}`;
    const polyline: PolylineEntity = {
      id,
      type: 'POLYLINE',
      layer,
      vertices: vertices.map(v => ({ x: v.x, y: v.y, z: 0 })),
      closed,
      color: color || this.layers.get(layer)?.color || '#FFFFFF'
    };
    this.entities.set(id, polyline);
    return polyline;
  }

  public deleteEntity(id: string): boolean {
    return this.entities.delete(id);
  }

  public clear() {
    this.entities.clear();
    this.nextId = 1;
    this.staticBatches = [];
    this.staticBounds = null;
  }

  /** 대용량 도면의 읽기 전용 선분 묶음 */
  public getStaticBatches(): StaticLineBatch[] {
    return this.staticBatches;
  }

  public getStaticOrigin(): Point2D {
    return this.staticOrigin;
  }

  public getStaticLineCount(): number {
    let n = 0;
    for (const b of this.staticBatches) n += b.count;
    return n;
  }

  /**
   * 서버 또는 파서에서 정제된 엔티티 데이터를 고속 일괄 적재
   */
  public loadParsedEntities(data: {
    entities: Array<any>;
    layers?: string[];
    layerColors?: Record<string, string>;
    lineBatches?: Array<{ layer: string; color: string; count: number; data: string }>;
    lineOrigin?: { x: number; y: number };
  }): { lineCount: number; circleCount: number; textCount: number; hatchCount: number } {
    this.clear();
    this.resetLayers();
    let lineCount = 0;

    // 대용량 모드로 전달된 선분 묶음 해독 (base64 → Float32Array)
    if (data.lineBatches && data.lineBatches.length > 0) {
      const batches: StaticLineBatch[] = data.lineBatches.map(b => {
        const bin = atob(b.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { layer: b.layer, color: b.color, count: b.count, positions: new Float32Array(bytes.buffer, 0, bytes.length >> 2) };
      });
      this.setStaticBatches(batches, data.lineOrigin || { x: 0, y: 0 });
      lineCount += this.getStaticLineCount();
    }
    let circleCount = 0;
    let textCount = 0;
    let hatchCount = 0;

    for (const lName of data.layers || []) {
      if (!this.layers.has(lName)) {
        // 파일의 레이어 테이블 색상이 있으면 그대로 사용
        if (data.layerColors?.[lName]) this.addLayer(lName, data.layerColors[lName]);
        else if (lName === '7') this.addLayer('7', '#FFE873');
        else if (lName === 'SHEET') this.addLayer('SHEET', '#3FB950');
        else if (lName === '0') this.addLayer('0', '#FFFFFF');
        else this.addLayer(lName, '#00FFFF');
      }
    }

    for (const ent of data.entities) {
      const kind = this.addImportedEntity(ent);
      if (kind === 'LINE') lineCount++;
      else if (kind === 'CIRCLE') circleCount++;
      else if (kind === 'TEXT') textCount++;
      else if (kind === 'HATCH') hatchCount++;
    }

    return { lineCount, circleCount, textCount, hatchCount };
  }

  /** 파서/파일에서 읽은 개체 한 개를 추가한다. 추가했으면 개체 종류, 아니면 null */
  private addImportedEntity(ent: any): string | null {
    if (ent.type === 'LINE' && ent.start && ent.end) {
      this.addLine(ent.start, ent.end, ent.layer, ent.color);
    } else if (ent.type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
      this.addCircle(ent.center, ent.radius, ent.layer, ent.color);
    } else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
      this.addArc(ent.center, ent.radius, ent.startAngle, ent.endAngle, ent.layer, ent.color);
    } else if (ent.type === 'POLYLINE' && Array.isArray(ent.vertices)) {
      this.addPolyline(ent.vertices, !!ent.closed, ent.layer, ent.color);
    } else if (ent.type === 'TEXT' && ent.position && ent.text) {
      this.addText(ent.text, ent.position, ent.height || 2.5, ent.rotation || 0, ent.layer, ent.color, ent.anchor);
    } else if (ent.type === 'HATCH' && Array.isArray(ent.loops) && ent.loops.length > 0) {
      this.addHatch(ent.loops, ent.solid !== false, ent.layer, ent.color);
    } else if (ent.type === 'POINT' && ent.position) {
      this.addPoint(ent.position, ent.layer, ent.color);
    } else {
      return null;
    }
    return ent.type;
  }

  /** 읽기 전용 선분 묶음을 등록하고 그 범위(Extents)를 계산한다 */
  private setStaticBatches(batches: StaticLineBatch[], origin: Point2D) {
    this.staticBatches = batches;
    this.staticOrigin = origin;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of batches) {
      const p = b.positions;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i], y = p[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    this.staticBounds = isFinite(minX)
      ? { minX: minX + origin.x, minY: minY + origin.y, maxX: maxX + origin.x, maxY: maxY + origin.y }
      : null;
  }

  /**
   * 가벼운 도면(.cadlite) 저장용 데이터: 현재 도면의 개체·레이어·읽기 전용 선분 묶음.
   * (선분 좌표는 Float32 정밀도라 약 0.01 이내 오차가 있다)
   */
  public getLiteSnapshot(source?: string): LiteDecoded {
    const header: LiteHeader = {
      version: 1,
      source,
      layers: this.getLayers().map(l => l.name),
      layerColors: Object.fromEntries(this.getLayers().map(l => [l.name, l.color])),
      entities: this.getEntities(),
      lineOrigin: this.staticOrigin
    };
    return { header, batches: this.staticBatches };
  }

  /** 가벼운 도면(.cadlite)을 읽어 현재 도면으로 교체한다 */
  public loadLite(dec: LiteDecoded): { lineCount: number; circleCount: number; textCount: number; hatchCount: number } {
    this.clear();
    this.resetLayers();
    for (const name of dec.header.layers || []) {
      if (!this.layers.has(name)) this.addLayer(name, dec.header.layerColors?.[name] || '#FFFFFF');
    }
    let lineCount = 0, circleCount = 0, textCount = 0, hatchCount = 0;
    if (dec.batches.length > 0) {
      this.setStaticBatches(dec.batches, dec.header.lineOrigin || { x: 0, y: 0 });
      lineCount += this.getStaticLineCount();
    }
    for (const ent of dec.header.entities || []) {
      const kind = this.addImportedEntity(ent);
      if (kind === 'LINE') lineCount++;
      else if (kind === 'CIRCLE') circleCount++;
      else if (kind === 'TEXT') textCount++;
      else if (kind === 'HATCH') hatchCount++;
    }
    return { lineCount, circleCount, textCount, hatchCount };
  }

  /**
   * 도면 전체 바운딩 박스 (Extents) 정밀 계산
   */
  public getBoundingBox(): BoundingBox | null {
    if (this.entities.size === 0 && !this.staticBounds) return null;

    let minX = this.staticBounds ? this.staticBounds.minX : Infinity;
    let minY = this.staticBounds ? this.staticBounds.minY : Infinity;
    let maxX = this.staticBounds ? this.staticBounds.maxX : -Infinity;
    let maxY = this.staticBounds ? this.staticBounds.maxY : -Infinity;

    for (const ent of this.entities.values()) {
      if (ent.type === 'LINE') {
        minX = Math.min(minX, ent.start.x, ent.end.x);
        minY = Math.min(minY, ent.start.y, ent.end.y);
        maxX = Math.max(maxX, ent.start.x, ent.end.x);
        maxY = Math.max(maxY, ent.start.y, ent.end.y);
      } else if (ent.type === 'CIRCLE') {
        minX = Math.min(minX, ent.center.x - ent.radius);
        minY = Math.min(minY, ent.center.y - ent.radius);
        maxX = Math.max(maxX, ent.center.x + ent.radius);
        maxY = Math.max(maxY, ent.center.y + ent.radius);
      } else if (ent.type === 'ARC') {
        const arc = ent as ArcEntity;
        minX = Math.min(minX, arc.center.x - arc.radius);
        minY = Math.min(minY, arc.center.y - arc.radius);
        maxX = Math.max(maxX, arc.center.x + arc.radius);
        maxY = Math.max(maxY, arc.center.y + arc.radius);
      } else if (ent.type === 'POLYLINE') {
        const pline = ent as PolylineEntity;
        for (const v of pline.vertices) {
          minX = Math.min(minX, v.x);
          minY = Math.min(minY, v.y);
          maxX = Math.max(maxX, v.x);
          maxY = Math.max(maxY, v.y);
        }
      } else if (ent.type === 'TEXT') {
        const h = ent.height;
        const estWidth = ent.text.length * (h * 0.7);
        minX = Math.min(minX, ent.position.x);
        minY = Math.min(minY, ent.position.y);
        maxX = Math.max(maxX, ent.position.x + estWidth);
        maxY = Math.max(maxY, ent.position.y + h);
      } else if (ent.type === 'POINT') {
        minX = Math.min(minX, ent.position.x);
        minY = Math.min(minY, ent.position.y);
        maxX = Math.max(maxX, ent.position.x);
        maxY = Math.max(maxY, ent.position.y);
      } else if (ent.type === 'HATCH') {
        for (const loop of (ent as HatchEntity).loops) {
          for (const p of loop) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
    }

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return null;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(width, 1),
      height: Math.max(height, 1),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * 두 점 간의 거리 및 수치 측정 (AutoCAD DIST 명령 사양)
   */
  public static measure(p1: Point2D, p2: Point2D): MeasureResult {
    const deltaX = p2.x - p1.x;
    const deltaY = p2.y - p1.y;
    const distance = Math.hypot(deltaX, deltaY);
    let angleRad = Math.atan2(deltaY, deltaX);
    if (angleRad < 0) angleRad += Math.PI * 2;
    const angleDeg = (angleRad * 180) / Math.PI;

    return {
      p1,
      p2,
      distance: Number(distance.toFixed(4)),
      deltaX: Number(deltaX.toFixed(4)),
      deltaY: Number(deltaY.toFixed(4)),
      angleDeg: Number(angleDeg.toFixed(2))
    };
  }

  /**
   * 다각형 꼭짓점들을 이용한 면적(AREA) 및 둘레(Perimeter) 정밀 계산 (신발끈 공식 / Shoelace Formula)
   */
  public static measureArea(points: Point2D[]): AreaResult {
    if (!points || points.length < 3) {
      return { points: points || [], areaMm2: 0, areaM2: 0, perimeterMm: 0 };
    }

    let area = 0;
    let perimeter = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];

      area += p1.x * p2.y - p2.x * p1.y;
      perimeter += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    const areaMm2 = Math.abs(area) / 2;
    const areaM2 = areaMm2 / 1_000_000;

    return {
      points,
      areaMm2: Number(areaMm2.toFixed(4)),
      areaM2: Number(areaM2.toFixed(6)),
      perimeterMm: Number(perimeter.toFixed(4))
    };
  }

  /**
   * 원/호 객체의 기하 수치 계산 (반지름, 지름, 원주, 면적)
   */
  public static measureCircle(center: Point2D, radius: number): CircleMeasureResult {
    const diameter = radius * 2;
    const circumference = 2 * Math.PI * radius;
    const areaMm2 = Math.PI * radius * radius;

    return {
      center,
      radius: Number(radius.toFixed(4)),
      diameter: Number(diameter.toFixed(4)),
      circumference: Number(circumference.toFixed(4)),
      areaMm2: Number(areaMm2.toFixed(4))
    };
  }

  /**
   * AutoCAD 및 CADian 등에서 열리는 DXF를 목표로 한 문자열 내보내기 (개체 색·문자 정렬 유지, HATCH는 경계선으로 저장)
   */
  public exportDxf(): string {
    const d = new Drawing();
    d.setUnits('Millimeters');

    // 레이어 등록
    for (const layer of this.layers.values()) {
      let aciColor = Drawing.ACI.WHITE;
      const lower = layer.color.toLowerCase();
      if (lower === '#ff0000' || lower === '#ff5555') aciColor = Drawing.ACI.RED;
      else if (lower === '#00ff00' || lower === '#3fb950') aciColor = Drawing.ACI.GREEN;
      else if (lower === '#0000ff') aciColor = Drawing.ACI.BLUE;
      else if (lower === '#00ffff') aciColor = Drawing.ACI.CYAN;
      else if (lower === '#ffff00') aciColor = Drawing.ACI.YELLOW;
      else if (lower === '#ff00ff') aciColor = Drawing.ACI.MAGENTA;

      d.addLayer(layer.name, aciColor, 'CONTINUOUS');
    }

    // 엔티티에 사용된 미등록 레이어 자동 추가 (누락 방지)
    for (const ent of this.entities.values()) {
      if (!(d as any).layers[ent.layer]) {
        d.addLayer(ent.layer, Drawing.ACI.WHITE, 'CONTINUOUS');
      }
    }

    // 엔티티 기록
    for (const ent of this.entities.values()) {
      d.setActiveLayer(ent.layer);
      const shapesBefore = shapeCount(d); // 이 개체가 추가하는 도형에 개체 색을 적용하기 위한 기준
      if (ent.type === 'LINE') {
        d.drawLine(ent.start.x, ent.start.y, ent.end.x, ent.end.y);
      } else if (ent.type === 'CIRCLE') {
        d.drawCircle(ent.center.x, ent.center.y, ent.radius);
      } else if (ent.type === 'ARC') {
        const arc = ent as ArcEntity;
        const startAngleDeg = (arc.startAngle * 180) / Math.PI;
        const endAngleDeg = (arc.endAngle * 180) / Math.PI;
        (d as any).drawArc(arc.center.x, arc.center.y, arc.radius, startAngleDeg, endAngleDeg);
      } else if (ent.type === 'POLYLINE') {
        const pline = ent as PolylineEntity;
        if (pline.vertices.length >= 2) {
          for (let i = 0; i < pline.vertices.length - 1; i++) {
            d.drawLine(pline.vertices[i].x, pline.vertices[i].y, pline.vertices[i + 1].x, pline.vertices[i + 1].y);
          }
          if (pline.closed && pline.vertices.length > 2) {
            const last = pline.vertices[pline.vertices.length - 1];
            const first = pline.vertices[0];
            d.drawLine(last.x, last.y, first.x, first.y);
          }
        }
      } else if (ent.type === 'TEXT') {
        // 문자 기준점(anchor)을 DXF 정렬로 저장 (없으면 왼쪽 기준선)
        const a = ent.anchor;
        const hAlign = a ? (a.x >= 0.75 ? 'right' : a.x >= 0.25 ? 'center' : 'left') : 'left';
        const vAlign = a ? (a.y >= 0.75 ? 'top' : a.y >= 0.25 ? 'middle' : 'baseline') : 'baseline';
        d.drawText(ent.position.x, ent.position.y, ent.height, ent.rotation, ent.text, hAlign, vAlign);
      } else if (ent.type === 'HATCH') {
        // HATCH는 구버전(R12 계열) DXF에 안전하게 쓸 수 없어, 경계선을 닫힌 폴리라인으로 저장 (채움은 저장되지 않음)
        for (const loop of (ent as HatchEntity).loops) {
          if (loop.length >= 3) d.drawPolyline(loop.map(p => [p.x, p.y] as [number, number]), true);
        }
      } else if (ent.type === 'POINT') {
        d.drawPoint(ent.position.x, ent.position.y);
      }
      // 개체 색을 유지 (레이어 색과 다를 때만 트루컬러 기록)
      applyEntityColor(d, shapesBefore, ent.color, this.layers.get(ent.layer)?.color);
    }

    return d.toDxfString();
  }

  /**
   * DXF 저장용 Blob. 대용량 도면의 읽기 전용 선분 묶음이 있으면 문자열 한 덩어리(약 5억 자 제한)로 만들 수 없으므로
   * 선분을 조각으로 나눠 ENTITIES 구역 끝에 이어 붙인다. (선 좌표는 화면용 Float32 정밀도라 약 0.01 이내 오차가 있다)
   */
  public exportDxfBlob(): Blob {
    const base = this.exportDxf();
    if (this.staticBatches.length === 0) return new Blob([base], { type: 'application/dxf' });

    const entStart = base.indexOf('ENTITIES');
    const endMarker = '\n0\nENDSEC';
    const insertAt = entStart < 0 ? -1 : base.indexOf(endMarker, entStart);
    if (insertAt < 0) return new Blob([base], { type: 'application/dxf' });

    const parts: string[] = [base.slice(0, insertAt)];
    const { x: ox, y: oy } = this.staticOrigin;
    const CHUNK = 20000; // 한 조각에 담는 선분 수
    for (const b of this.staticBatches) {
      const tc = hexToTrueColor(b.color);
      const head = `\n0\nLINE\n8\n${b.layer}${tc === null ? '' : `\n420\n${tc}`}`;
      for (let i = 0; i < b.count; i += CHUNK) {
        const end = Math.min(b.count, i + CHUNK);
        let s = '';
        for (let k = i; k < end; k++) {
          const p = b.positions;
          const x1 = (p[k * 4] + ox).toFixed(3), y1 = (p[k * 4 + 1] + oy).toFixed(3);
          const x2 = (p[k * 4 + 2] + ox).toFixed(3), y2 = (p[k * 4 + 3] + oy).toFixed(3);
          s += `${head}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0`;
        }
        parts.push(s);
      }
    }
    parts.push(base.slice(insertAt));
    return new Blob(parts, { type: 'application/dxf' });
  }

  /**
   * DXF 텍스트 데이터를 파싱하여 모델에 적재
   * (LINE, CIRCLE, LWPOLYLINE, POLYLINE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, DIMENSION, INSERT 블록 전수 전개)
   */
  public loadFromDxf(dxfContent: string): {
    lineCount: number;
    circleCount: number;
    polylineCount: number;
    textCount: number;
    blockInsertCount: number;
  } {
    this.clear();
    this.resetLayers();
    const parser = new DxfParser();
    const parsed = parser.parseSync(dxfContent);

    let lineCount = 0;
    let circleCount = 0;
    let polylineCount = 0;
    let textCount = 0;
    let blockInsertCount = 0;

    if (!parsed) return { lineCount, circleCount, polylineCount, textCount, blockInsertCount };

    // 테이블 레이어 정보 복원
    if (parsed.tables && parsed.tables.layer && parsed.tables.layer.layers) {
      for (const [name, lObj] of Object.entries(parsed.tables.layer.layers as any)) {
        const colorIndex = (lObj as any).colorNumber || 7;
        const colorHex = ACI_COLOR_MAP[colorIndex] || '#FFFFFF';
        this.addLayer(name, colorHex);
      }
    }

    const blocks = parsed.blocks || {};

    // 엔티티 처리 내부 재귀/변환 함수
    const processEntity = (ent: any, transform?: { x: number; y: number; scaleX: number; scaleY: number; rotationRad: number }) => {
      const layer = ent.layer || '0';
      if (!this.layers.has(layer)) {
        this.addLayer(layer, '#00FFFF');
      }

      // 변환 헬퍼 (블록 INSERT 시 적용)
      const tf = (pt: { x: number; y: number }): Point2D => {
        if (!transform) return { x: pt.x, y: pt.y };
        const sx = pt.x * transform.scaleX;
        const sy = pt.y * transform.scaleY;
        const rx = sx * Math.cos(transform.rotationRad) - sy * Math.sin(transform.rotationRad);
        const ry = sx * Math.sin(transform.rotationRad) + sy * Math.cos(transform.rotationRad);
        return {
          x: rx + transform.x,
          y: ry + transform.y
        };
      };

      // 1. 선분 (LINE)
      if (ent.type === 'LINE' && ent.vertices && ent.vertices.length >= 2) {
        const p1 = tf(ent.vertices[0]);
        const p2 = tf(ent.vertices[1]);
        this.addLine(p1, p2, layer);
        lineCount++;
      }
      // 2. 경량 폴리라인 및 폴리라인 (LWPOLYLINE / POLYLINE) - 네이티브 지원
      else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && ent.vertices.length >= 2) {
        polylineCount++;
        const vertices = ent.vertices.map(tf);
        const isClosed = ent.shape || ent.closed || false;
        this.addPolyline(vertices, isClosed, layer);
      }
      // 3. 원 (CIRCLE)
      else if (ent.type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
        const c = tf(ent.center);
        const scale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
        this.addCircle(c, ent.radius * scale, layer);
        circleCount++;
      }
      // 4. 호 (ARC) - 네이티브 지원
      else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
        const c = tf(ent.center);
        const scale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
        const r = ent.radius * scale;
        const rot = transform ? transform.rotationRad : 0;
        const startAngle = (ent.startAngle || 0) + rot;
        const endAngle = (ent.endAngle || Math.PI * 2) + rot;
        this.addArc(c, r, startAngle, endAngle, layer);
      }
      // 5. 텍스트 / 다중행 텍스트 (TEXT / MTEXT)
      else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && (ent.text || ent.string)) {
        const rawText = ent.text || ent.string || '';
        const cleanText = cleanCadMText(rawText);
        if (cleanText) {
          // 문자 기준점(anchor) 복원: MTEXT는 attachmentPoint(1~9), TEXT는 halign/valign(정렬 지정 시 정렬점 endPoint 기준)
          let srcPt = ent.startPoint || ent.position || { x: 0, y: 0 };
          let anchor: { x: number; y: number } | undefined;
          if (ent.type === 'MTEXT') {
            const ap = ent.attachmentPoint || 1;
            anchor = { x: [0, 0.5, 1][(ap - 1) % 3], y: [1, 0.5, 0][Math.floor((ap - 1) / 3)] };
          } else {
            const hj = ent.halign || 0;
            const vj = ent.valign || 0;
            if (hj || vj) {
              if (hj !== 3 && hj !== 5 && ent.endPoint) srcPt = ent.endPoint;
              anchor = { x: [0, 0.5, 1, 0, 0.5, 0][hj] ?? 0, y: hj === 4 ? 0.5 : ([0, 0, 0.5, 1][vj] ?? 0) };
            }
          }
          const pos = tf(srcPt);
          const h = (ent.textHeight || ent.height || 2.5) * (transform ? transform.scaleY : 1);
          const rot = (ent.rotation || 0) + (transform ? (transform.rotationRad * 180) / Math.PI : 0);
          this.addText(cleanText, pos, h, rot, layer, undefined, anchor);
          textCount++;
        }
      }
      // 6. 점 (POINT)
      else if (ent.type === 'POINT' && ent.position) {
        this.addPoint(tf(ent.position), layer);
      }
      // 7. 타원 (ELLIPSE)
      else if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
        const c = tf(ent.center);
        const a = Math.hypot(ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y);
        const b = a * (ent.axisRatio || 0.5);
        const rot = Math.atan2(ent.majorAxisEndPoint.y, ent.majorAxisEndPoint.x) + (transform ? transform.rotationRad : 0);
        const segs = 32;
        let prevX = c.x + a * Math.cos(0) * Math.cos(rot) - b * Math.sin(0) * Math.sin(rot);
        let prevY = c.y + a * Math.cos(0) * Math.sin(rot) + b * Math.sin(0) * Math.cos(rot);
        for (let s = 1; s <= segs; s++) {
          const th = (s / segs) * Math.PI * 2;
          const curX = c.x + a * Math.cos(th) * Math.cos(rot) - b * Math.sin(th) * Math.sin(rot);
          const curY = c.y + a * Math.cos(th) * Math.sin(rot) + b * Math.sin(th) * Math.cos(rot);
          this.addLine({ x: prevX, y: prevY }, { x: curX, y: curY }, layer);
          lineCount++;
          prevX = curX;
          prevY = curY;
        }
      }
      // 8. 블록 참조 (INSERT) - 블록 정의 엔티티 전개
      else if (ent.type === 'INSERT' && ent.name && blocks[ent.name]) {
        blockInsertCount++;
        const blk = blocks[ent.name];
        const insPos = tf(ent.position || { x: 0, y: 0 });
        const scaleX = (ent.xScale || ent.scaleX || 1) * (transform ? transform.scaleX : 1);
        const scaleY = (ent.yScale || ent.scaleY || 1) * (transform ? transform.scaleY : 1);
        const rotRad = ((ent.rotation || 0) * Math.PI) / 180 + (transform ? transform.rotationRad : 0);

        if (blk.entities && Array.isArray(blk.entities)) {
          for (const bEnt of blk.entities) {
            processEntity(bEnt, {
              x: insPos.x,
              y: insPos.y,
              scaleX,
              scaleY,
              rotationRad: rotRad
            });
          }
        }
      }
      // 9. 치수 (DIMENSION) - 블록 참조 전개 또는 기본 치수선 복원
      else if (ent.type === 'DIMENSION') {
        if (ent.block && blocks[ent.block]) {
          const blk = blocks[ent.block];
          if (blk.entities && Array.isArray(blk.entities)) {
            for (const bEnt of blk.entities) {
              processEntity(bEnt, transform);
            }
          }
        } else if (ent.linearOrAngularPoint1 && ent.linearOrAngularPoint2) {
          this.addLine(tf(ent.linearOrAngularPoint1), tf(ent.linearOrAngularPoint2), layer);
          lineCount++;
        }
        if (ent.text && ent.text !== '<>') {
          const textPos = tf(ent.middleOfText || ent.insertionPoint || { x: 0, y: 0 });
          this.addText(ent.text, textPos, 2.5, 0, layer);
          textCount++;
        }
      }
      // 10. 솔리드 / 3DFACE (외곽선 선분으로 정밀 복원)
      else if (ent.type === 'SOLID' || ent.type === '3DFACE') {
        const pts = ent.points || ent.corners;
        if (Array.isArray(pts) && pts.length >= 3) {
          this.addLine(tf(pts[0]), tf(pts[1]), layer);
          this.addLine(tf(pts[1]), tf(pts[2]), layer);
          if (pts.length >= 4 && pts[3]) {
            this.addLine(tf(pts[2]), tf(pts[3]), layer);
            this.addLine(tf(pts[3]), tf(pts[0]), layer);
            lineCount += 4;
          } else {
            this.addLine(tf(pts[2]), tf(pts[0]), layer);
            lineCount += 3;
          }
        }
      }
      // 11. 스플라인 (SPLINE)
      else if (ent.type === 'SPLINE' && Array.isArray(ent.controlPoints) && ent.controlPoints.length >= 2) {
        const cpts = ent.controlPoints;
        for (let i = 0; i < cpts.length - 1; i++) {
          this.addLine(tf(cpts[i]), tf(cpts[i + 1]), layer);
          lineCount++;
        }
      }
    };

    // 최상위 엔티티 순회 처리
    if (parsed.entities && Array.isArray(parsed.entities)) {
      for (const ent of parsed.entities) {
        processEntity(ent);
      }
    }

    return { lineCount, circleCount, polylineCount, textCount, blockInsertCount };
  }
}

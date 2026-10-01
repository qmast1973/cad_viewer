import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// 벡터 문자용 글꼴 (Droid Sans, Apache-2.0 - THIRD_PARTY_NOTICES.md 참조)
import droidSansData from 'three/examples/fonts/droid/droid_sans_regular.typeface.json';
import {
  CadModel,
  CadEntity,
  HatchEntity,
  TextEntity,
  Point2D,
  MeasureResult,
  AreaResult,
  CircleMeasureResult
} from '../core/cad-model.ts';

export type CadToolMode = 'SELECT' | 'PAN' | 'LINE' | 'CIRCLE' | 'DIST' | 'AREA' | 'MOVE';

interface CadCanvasProps {
  model: CadModel;
  mode: CadToolMode;
  orthoEnabled: boolean;
  osnapEnabled: boolean;
  textVisible?: boolean;
  gridEnabled?: boolean;
  theme?: 'DARK' | 'LIGHT';
  zoomTrigger?: number;
  /** 화면 버튼(모바일)으로 우클릭과 같은 '완료/취소' 동작을 요청한다. id가 바뀔 때마다 한 번 실행 */
  commandSignal?: { id: number };
  onMeasureComplete?: (result: MeasureResult) => void;
  onAreaComplete?: (result: AreaResult) => void;
  onSelectEntity?: (entity: CadEntity | null) => void;
  onModelChange?: () => void;
  onLogMessage?: (msg: string) => void;
}

interface SnapPoint {
  point: Point2D;
  type: 'ENDPOINT' | 'CENTER' | 'MIDPOINT' | 'NODE';
}

// 고해상도 텍스트 스프라이트 생성기 (개선: 한글 지원, 크기 최적화)
function createTextSprite(
  text: string,
  rawHeight: number,
  color: string = '#FFE873',
  bboxDiag: number = 500,
  anchor?: { x: number; y: number }
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();

  // 고해상도 렌더링: 2배 스케일 (안정적 렌더링)
  let dpr = (window.devicePixelRatio || 1) * 1.5;
  const fontSize = 96;
  const padding = 20;

  // 텍스트 크기 측정 (한글 폰트 포함)
  ctx.font = `bold ${fontSize}px "Noto Sans CJK KR", "Arial Unicode MS", "MS Gothic", sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = Math.max(metrics.width, 24);
  // 긴 문자열은 GPU 텍스처 최대 폭(8192)을 넘으면 자동 축소되어 흐려지므로 배율을 제한
  dpr = Math.min(dpr, 8192 / (textWidth + padding * 2));

  canvas.width = Math.ceil((textWidth + padding * 2) * dpr);
  canvas.height = Math.ceil((fontSize + padding * 2) * dpr);
  ctx.scale(dpr, dpr);

  // 텍스트 렌더링 (한글 폰트 명시)
  ctx.font = `bold ${fontSize}px "Noto Sans CJK KR", "Arial Unicode MS", "MS Gothic", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.antialias = 'subpixel';
  ctx.fillText(text, padding, (fontSize + padding) / 2);

  const texture = new THREE.CanvasTexture(canvas);
  // 축소 표시 시 뭉개짐 방지: 밉맵 + 이방성 필터
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;

  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: 0.95
  });
  const sprite = new THREE.Sprite(spriteMaterial);

  // 크기 계산 개선: 0.05 → 0.20 (4배 확대, 안정적)
  const aspect = canvas.width / canvas.height;
  const maxAllowedHeight = Math.max(bboxDiag * 0.20, 12);
  const clampedHeight = Math.min(Math.max(rawHeight || 2.5, 1.5), maxAllowedHeight);
  const worldWidth = clampedHeight * aspect;

  sprite.scale.set(worldWidth, clampedHeight, 1);
  if (anchor) {
    // 문자 기준점(MTEXT 정렬 등): 여백(padding)을 제외한 글자 영역 기준으로 위치 보정
    sprite.center.set(
      (padding + anchor.x * textWidth) / (textWidth + padding * 2),
      (padding + anchor.y * fontSize) / (fontSize + padding * 2)
    );
  } else {
    sprite.center.set(0, 0.5);
  }
  sprite.renderOrder = 1;

  return sprite;
}

// ─── 벡터 문자 (글자 윤곽을 삼각형 메시로 그려 어떤 배율에서도 선명) ───
const VECTOR_FONT = new FontLoader().parse(droidSansData as any);

// CAD 문자 높이(대문자 높이) 기준으로 크기를 맞추기 위한 글꼴별 대문자 높이 비율
const VECTOR_CAP_RATIO = (() => {
  const g = new THREE.ShapeGeometry(VECTOR_FONT.generateShapes('H', 1));
  g.computeBoundingBox();
  const h = g.boundingBox ? g.boundingBox.max.y - g.boundingBox.min.y : 0.72;
  g.dispose();
  return h > 0 ? h : 0.72;
})();

// 폭 보정 계수: 원본 CAD 글꼴(SHX 등)은 Droid Sans보다 좁아 그대로 쓰면 글자가 겹친다.
// MAIN_COM_01.dwg의 문자 위치로 측정하여, 겹침이 0쌍이 되는 값(0.8)으로 정했다. (1.0이면 3쌍 겹침)
const VECTOR_WIDTH_FACTOR = 0.8;

/** 글꼴에 모든 글자가 있으면 벡터로 그릴 수 있다 (한글 등은 기존 이미지 방식으로 폴백) */
function canVectorize(text: string): boolean {
  const glyphs = (VECTOR_FONT.data as any).glyphs;
  for (const ch of text) {
    if (ch === ' ') continue;
    if (!glyphs[ch]) return false;
  }
  return true;
}

/**
 * 문자를 벡터 지오메트리로 생성. 위치(x,y), 회전, 기준점(anchor)이 이미 적용되어 있다.
 * anchor: x 0=왼쪽/0.5=가운데/1=오른쪽, y 0=기준선/0.5=대문자 중간/1=대문자 위 (미지정이면 왼쪽 기준선 = CAD TEXT 기본)
 */
function createTextGeometry(
  text: string,
  height: number,
  x: number,
  y: number,
  z: number,
  rotationDeg: number,
  anchor?: { x: number; y: number }
): THREE.BufferGeometry | null {
  const size = height / VECTOR_CAP_RATIO;
  const shapes = VECTOR_FONT.generateShapes(text, size);
  if (shapes.length === 0) return null;

  const geom = new THREE.ShapeGeometry(shapes, 4);
  geom.computeBoundingBox();
  const width = (geom.boundingBox ? geom.boundingBox.max.x : 0) * VECTOR_WIDTH_FACTOR;

  geom.scale(VECTOR_WIDTH_FACTOR, 1, 1);
  geom.translate(-(anchor?.x ?? 0) * width, -(anchor?.y ?? 0) * height, 0);
  if (rotationDeg) geom.rotateZ((rotationDeg * Math.PI) / 180);
  geom.translate(x, y, z);
  return geom;
}

export const CadCanvas: React.FC<CadCanvasProps> = ({
  model,
  mode,
  orthoEnabled,
  osnapEnabled,
  textVisible = true,
  gridEnabled = true,
  theme = 'DARK',
  zoomTrigger,
  commandSignal,
  onMeasureComplete,
  onAreaComplete,
  onSelectEntity,
  onModelChange,
  onLogMessage
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // 상호작용 상태
  const [worldMouse, setWorldMouse] = useState<Point2D>({ x: 0, y: 0 });
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const firstPointRef = useRef<Point2D | null>(null);
  const areaPointsRef = useRef<Point2D[]>([]);
  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isMovingRef = useRef<boolean>(false);
  const moveStartRef = useRef<Point2D>({ x: 0, y: 0 });
  // 터치 조작용 상태 (손가락 위치, 두 손가락 간격, 드래그 여부)
  const touchRef = useRef<{ pts: { x: number; y: number }[]; dist: number; moved: boolean; moving: boolean }>({
    pts: [], dist: 0, moved: false, moving: false
  });
  const lastAspectRef = useRef<number>(0);
  const textLodGroupRef = useRef<THREE.Group>(new THREE.Group());
  const textLodRef = useRef<() => void>(() => {});
  const lodForceRef = useRef<boolean>(false);
  const zoomExtentsRef = useRef<() => void>(() => {});
  const lastTouchTimeRef = useRef<number>(0);
  const suppressClickRef = useRef<boolean>(false);
  // 터치 리스너(한 번만 등록)에서 최신 값을 읽기 위한 참조
  const modeRef = useRef<CadToolMode>(mode);
  const selectedIdRef = useRef<string | null>(null);

  // Three.js 그룹
  const entityGroupRef = useRef<THREE.Group>(new THREE.Group());
  const highlightGroupRef = useRef<THREE.Group>(new THREE.Group());
  const previewGroupRef = useRef<THREE.Group>(new THREE.Group());
  const snapGroupRef = useRef<THREE.Group>(new THREE.Group());
  const gridGroupRef = useRef<THREE.Group>(new THREE.Group());

  // 화면 좌표 -> WCS 도면 좌표 변환
  const screenToWorld = useCallback((screenX: number, screenY: number): Point2D => {
    if (!containerRef.current || !cameraRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const xNdc = ((screenX - rect.left) / rect.width) * 2 - 1;
    const yNdc = -(((screenY - rect.top) / rect.height) * 2 - 1);

    const vec = new THREE.Vector3(xNdc, yNdc, 0);
    vec.unproject(cameraRef.current);
    return { x: vec.x, y: vec.y };
  }, []);

  // OSNAP 자석 스냅점 탐색
  const findSnapPoint = useCallback((rawPoint: Point2D): SnapPoint | null => {
    if (!osnapEnabled || !cameraRef.current) return null;

    const zoom = cameraRef.current.zoom;
    const snapRadius = 15 / zoom;

    let nearestSnap: SnapPoint | null = null;
    let minDistance = snapRadius;

    for (const ent of model.getEntities()) {
      if (ent.type === 'LINE') {
        const dStart = Math.hypot(ent.start.x - rawPoint.x, ent.start.y - rawPoint.y);
        if (dStart < minDistance) {
          minDistance = dStart;
          nearestSnap = { point: { x: ent.start.x, y: ent.start.y }, type: 'ENDPOINT' };
        }
        const dEnd = Math.hypot(ent.end.x - rawPoint.x, ent.end.y - rawPoint.y);
        if (dEnd < minDistance) {
          minDistance = dEnd;
          nearestSnap = { point: { x: ent.end.x, y: ent.end.y }, type: 'ENDPOINT' };
        }
        const midX = (ent.start.x + ent.end.x) / 2;
        const midY = (ent.start.y + ent.end.y) / 2;
        const dMid = Math.hypot(midX - rawPoint.x, midY - rawPoint.y);
        if (dMid < minDistance) {
          minDistance = dMid;
          nearestSnap = { point: { x: midX, y: midY }, type: 'MIDPOINT' };
        }
      } else if (ent.type === 'CIRCLE') {
        const dCenter = Math.hypot(ent.center.x - rawPoint.x, ent.center.y - rawPoint.y);
        if (dCenter < minDistance) {
          minDistance = dCenter;
          nearestSnap = { point: { x: ent.center.x, y: ent.center.y }, type: 'CENTER' };
        }
      } else if (ent.type === 'POINT' || ent.type === 'TEXT') {
        const pt = ent.position;
        const dPt = Math.hypot(pt.x - rawPoint.x, pt.y - rawPoint.y);
        if (dPt < minDistance) {
          minDistance = dPt;
          nearestSnap = { point: { x: pt.x, y: pt.y }, type: 'NODE' };
        }
      }
    }

    return nearestSnap;
  }, [model, osnapEnabled]);

  // 엔티티 시각화 갱신
  const rebuildEntities = useCallback(() => {
    if (!entityGroupRef.current) return;
    const group = entityGroupRef.current;

    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if ('geometry' in obj) (obj as any).geometry.dispose();
      if ('material' in obj) (obj as any).material.dispose();
    }

    const bbox = model.getBoundingBox();
    const bboxDiag = bbox ? Math.hypot(bbox.width, bbox.height) : 500;
    const layers = new Map(model.getLayers().map(l => [l.name, l]));
    // 벡터 문자는 색상별로 지오메트리를 모아 하나의 메시로 합쳐 그린다 (그리기 호출 수 절감)
    const textBatches = new Map<number, THREE.BufferGeometry[]>();
    // 선분(LINE)도 색상별로 모아 하나의 LineSegments로 그린다 (개체마다 그리기 호출을 만들면 수만 개부터 느려진다)
    const lineBatches = new Map<number, number[]>();

    // 대용량 도면의 읽기 전용 선분 묶음: 좌표 배열 그대로 GPU에 올린다 (개체 객체 없음)
    for (const batch of model.getStaticBatches()) {
      const layer = layers.get(batch.layer);
      if (layer && !layer.visible) continue;
      let hex = batch.color ? parseInt(batch.color.replace('#', ''), 16) : 0xffffff;
      if (theme === 'LIGHT' && hex === 0xffffff) hex = 0x111111;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(batch.positions, 2));
      const seg = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: hex }));
      const origin = model.getStaticOrigin();
      seg.position.set(origin.x, origin.y, 0);
      seg.frustumCulled = false; // 좌표가 원점 기준 상대값이라 경계 계산을 생략한다
      seg.renderOrder = 3;
      group.add(seg);
    }

    for (const ent of model.getEntities()) {
      const layer = layers.get(ent.layer);
      if (layer && !layer.visible) continue;

      const isLight = theme === 'LIGHT';
      let colorHex = ent.color ? parseInt(ent.color.replace('#', ''), 16) : (isLight ? 0x111111 : 0xffffff);
      if (isLight && colorHex === 0xffffff) colorHex = 0x111111;

      if (ent.type === 'LINE') {
        const arr = lineBatches.get(colorHex);
        const coords = [ent.start.x, ent.start.y, 0, ent.end.x, ent.end.y, 0];
        if (arr) arr.push(...coords);
        else lineBatches.set(colorHex, coords);
      } else if (ent.type === 'CIRCLE') {
        const segments = 64;
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          points.push(new THREE.Vector3(
            ent.center.x + Math.cos(theta) * ent.radius,
            ent.center.y + Math.sin(theta) * ent.radius,
            0
          ));
        }
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 });
        const circle = new THREE.LineLoop(geom, mat);
        circle.renderOrder = 3;
        group.add(circle);
      } else if (ent.type === 'ARC') {
        const arc = ent as any;
        const segments = 32;
        const points: THREE.Vector3[] = [];
        let diff = arc.endAngle - arc.startAngle;
        if (diff < 0) diff += Math.PI * 2;
        for (let i = 0; i <= segments; i++) {
          const theta = arc.startAngle + (i / segments) * diff;
          points.push(new THREE.Vector3(
            arc.center.x + Math.cos(theta) * arc.radius,
            arc.center.y + Math.sin(theta) * arc.radius,
            0
          ));
        }
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 });
        const arcLine = new THREE.Line(geom, mat);
        arcLine.renderOrder = 3;
        group.add(arcLine);
      } else if (ent.type === 'POLYLINE') {
        const pline = ent as any;
        const points = pline.vertices.map((v: any) => new THREE.Vector3(v.x, v.y, 0));
        if (pline.closed && points.length > 0) {
          points.push(points[0]);
        }
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 });
        const polyline = new THREE.Line(geom, mat);
        polyline.renderOrder = 3;
        group.add(polyline);
      } else if (ent.type === 'TEXT') {
        if (!textVisible) continue;
        if (model.getStaticLineCount() > 0) continue; // 대용량 도면: updateTextLod가 보이는 범위만 그린다
        const textColor = ent.color || (layer ? layer.color : (isLight ? '#003366' : '#FFE873'));
        // 글꼴에 있는 글자만으로 된 문자는 벡터로, 그 외(한글 등)는 아래의 이미지 스프라이트로 폴백
        if (canVectorize(ent.text)) {
          const geom = createTextGeometry(ent.text, ent.height || 2.5, ent.position.x, ent.position.y, 0.5, ent.rotation || 0, ent.anchor);
          if (geom) {
            const list = textBatches.get(colorHex);
            if (list) list.push(geom);
            else textBatches.set(colorHex, [geom]);
          }
          continue;
        }
        const textHeight = (ent.height || 2.5) * 2;
        const sprite = createTextSprite(ent.text, textHeight, textColor, bboxDiag, ent.anchor);
        sprite.position.set(ent.position.x, ent.position.y, 0.5);
        if (ent.rotation) {
          sprite.material.rotation = (ent.rotation * Math.PI) / 180;
        }
        group.add(sprite);
      } else if (ent.type === 'HATCH') {
        // 채움(HATCH): 면적이 가장 큰 루프를 바깥 경계, 나머지를 구멍으로 처리
        const hatch = ent as HatchEntity;
        const loops = hatch.loops.filter(l => l.length >= 3);
        if (loops.length === 0) continue;
        const toVec = (l: Point2D[]) => l.map(p => new THREE.Vector2(p.x, p.y));
        if (hatch.solid) {
          const area = (l: Point2D[]) => {
            let a = 0;
            for (let i = 0; i < l.length; i++) {
              const p = l[i];
              const q = l[(i + 1) % l.length];
              a += p.x * q.y - q.x * p.y;
            }
            return Math.abs(a / 2);
          };
          const sorted = [...loops].sort((a, b) => area(b) - area(a));
          const shape = new THREE.Shape(toVec(sorted[0]));
          for (let i = 1; i < sorted.length; i++) shape.holes.push(new THREE.Path(toVec(sorted[i])));
          const geom = new THREE.ShapeGeometry(shape);
          const mat = new THREE.MeshBasicMaterial({
            color: colorHex,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          });
          const mesh = new THREE.Mesh(geom, mat);
          mesh.position.z = -0.01;
          mesh.renderOrder = 2;
          group.add(mesh);
        } else {
          for (const l of loops) {
            const geom = new THREE.BufferGeometry().setFromPoints(l.map(p => new THREE.Vector3(p.x, p.y, 0)));
            const outline = new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color: colorHex }));
            outline.renderOrder = 3;
            group.add(outline);
          }
        }
      } else if (ent.type === 'POINT') {
        const pSize = Math.max(bboxDiag * 0.005, 1.5);
        const pts = [
          new THREE.Vector3(ent.position.x - pSize, ent.position.y, 0),
          new THREE.Vector3(ent.position.x + pSize, ent.position.y, 0),
          new THREE.Vector3(ent.position.x, ent.position.y - pSize, 0),
          new THREE.Vector3(ent.position.x, ent.position.y + pSize, 0)
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 });
        const ptMark = new THREE.LineSegments(geom, mat);
        ptMark.renderOrder = 3;
        group.add(ptMark);
      }
    }

    // 모아 둔 선분을 색상별 LineSegments 하나로 추가
    for (const [hex, coords] of lineBatches) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coords), 3));
      const seg = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: hex }));
      seg.renderOrder = 3;
      group.add(seg);
    }

    // 모아 둔 벡터 문자 지오메트리를 색상별 메시 하나로 합쳐 추가
    for (const [hex, geoms] of textBatches) {
      const merged = mergeGeometries(geoms, false);
      geoms.forEach(g => g.dispose());
      if (!merged) continue;
      const mat = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 4;
      group.add(mesh);
    }
    lodForceRef.current = true;
  }, [model, textVisible, theme]);

  // 대용량 도면의 문자: 지금 화면에 보이고 읽을 수 있는 크기(5px 이상)인 것만 그린다 (수만 개를 한꺼번에 만들면 멈춘다)
  const updateTextLod = useCallback(() => {
    const grp = textLodGroupRef.current;
    while (grp.children.length > 0) {
      const o: any = grp.children[0];
      grp.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    }
    if (!textVisible || model.getStaticLineCount() === 0 || !cameraRef.current || !containerRef.current) return;

    const cam = cameraRef.current;
    const halfW = (cam.right - cam.left) / 2 / cam.zoom;
    const halfH = (cam.top - cam.bottom) / 2 / cam.zoom;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const pxPerUnit = containerRef.current.clientHeight / (halfH * 2);
    const layers = new Map(model.getLayers().map(l => [l.name, l]));
    const isLight = theme === 'LIGHT';
    const MAX_TEXTS = 3000;
    const MAX_SPRITES = 400;

    const cands: TextEntity[] = [];
    for (const ent of model.getEntities()) {
      if (ent.type !== 'TEXT') continue;
      const h = ent.height || 2.5;
      if (h * pxPerUnit < 5) continue;
      const w = ent.text.length * h * 0.7;
      const x = ent.position.x;
      const y = ent.position.y;
      if (x + w < cx - halfW || x > cx + halfW || y + h < cy - halfH || y - h > cy + halfH) continue;
      const layer = layers.get(ent.layer);
      if (layer && !layer.visible) continue;
      cands.push(ent as TextEntity);
    }
    if (cands.length > MAX_TEXTS) {
      cands.sort((a, b) => Math.hypot(a.position.x - cx, a.position.y - cy) - Math.hypot(b.position.x - cx, b.position.y - cy));
      cands.length = MAX_TEXTS;
    }

    const bbox = model.getBoundingBox();
    const bboxDiag = bbox ? Math.hypot(bbox.width, bbox.height) : 500;
    const batches = new Map<number, THREE.BufferGeometry[]>();
    let sprites = 0;
    for (const ent of cands) {
      const layer = layers.get(ent.layer);
      let hex = ent.color ? parseInt(ent.color.replace('#', ''), 16) : (isLight ? 0x111111 : 0xffffff);
      if (isLight && hex === 0xffffff) hex = 0x111111;
      if (canVectorize(ent.text)) {
        const geom = createTextGeometry(ent.text, ent.height || 2.5, ent.position.x, ent.position.y, 0.5, ent.rotation || 0, ent.anchor);
        if (geom) {
          const list = batches.get(hex);
          if (list) list.push(geom);
          else batches.set(hex, [geom]);
        }
        continue;
      }
      if (sprites >= MAX_SPRITES) continue;
      sprites++;
      const textColor = ent.color || (layer ? layer.color : (isLight ? '#003366' : '#FFE873'));
      const sprite = createTextSprite(ent.text, (ent.height || 2.5) * 2, textColor, bboxDiag, ent.anchor);
      sprite.position.set(ent.position.x, ent.position.y, 0.5);
      if (ent.rotation) sprite.material.rotation = (ent.rotation * Math.PI) / 180;
      grp.add(sprite);
    }
    for (const [hex, geoms] of batches) {
      const merged = mergeGeometries(geoms, false);
      geoms.forEach(g => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide, depthWrite: false }));
      mesh.renderOrder = 4;
      grp.add(mesh);
    }
  }, [model, textVisible, theme]);
  textLodRef.current = updateTextLod;

  // 선택 하이라이트 갱신
  useEffect(() => {
    const grp = highlightGroupRef.current;
    while (grp.children.length > 0) grp.remove(grp.children[0]);

    if (!selectedEntityId) return;
    const ent = model.getEntities().find(e => e.id === selectedEntityId);
    if (!ent) return;

    if (ent.type === 'LINE') {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ent.start.x, ent.start.y, 1),
        new THREE.Vector3(ent.end.x, ent.end.y, 1)
      ]);
      const mat = new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 4 });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 5;
      grp.add(line);
    } else if (ent.type === 'CIRCLE') {
      const segments = 64;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const th = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(ent.center.x + Math.cos(th) * ent.radius, ent.center.y + Math.sin(th) * ent.radius, 1));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 4 });
      const circle = new THREE.LineLoop(geom, mat);
      circle.renderOrder = 5;
      grp.add(circle);
    } else if (ent.type === 'ARC') {
      const arc = ent as any;
      const segments = 32;
      const pts: THREE.Vector3[] = [];
      let diff = arc.endAngle - arc.startAngle;
      if (diff < 0) diff += Math.PI * 2;
      for (let i = 0; i <= segments; i++) {
        const th = arc.startAngle + (i / segments) * diff;
        pts.push(new THREE.Vector3(arc.center.x + Math.cos(th) * arc.radius, arc.center.y + Math.sin(th) * arc.radius, 1));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 4 });
      const arcLine = new THREE.Line(geom, mat);
      arcLine.renderOrder = 5;
      grp.add(arcLine);
    } else if (ent.type === 'POLYLINE') {
      const pline = ent as any;
      const points = pline.vertices.map((v: any) => new THREE.Vector3(v.x, v.y, 1));
      if (pline.closed && points.length > 0) {
        points.push(points[0]);
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 4 });
      const polyline = new THREE.Line(geom, mat);
      polyline.renderOrder = 5;
      grp.add(polyline);
    } else if (ent.type === 'HATCH') {
      // 채움 강조: 경계 루프를 주황색 윤곽선으로 표시
      for (const loop of ent.loops) {
        const geom = new THREE.BufferGeometry().setFromPoints(loop.map(p => new THREE.Vector3(p.x, p.y, 1)));
        const outline = new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color: 0xff9900, linewidth: 4 }));
        outline.renderOrder = 5;
        grp.add(outline);
      }
    }
  }, [selectedEntityId, model]);

  // Three.js 초기화
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme === 'LIGHT' ? 0xf6f8fa : 0x181a1b);
    sceneRef.current = scene;

    const aspect = width / height;
    lastAspectRef.current = aspect;
    const frustumSize = 250;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );
    camera.position.set(50, 50, 500);
    camera.lookAt(50, 50, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 휴대폰의 매우 높은 해상도에서 느려지지 않도록 제한
    rendererRef.current = renderer;

    containerRef.current.appendChild(renderer.domElement);

    // CAD 그리드 생성
    const gridColor1 = theme === 'LIGHT' ? 0xd0d7de : 0x3f4448;
    const gridColor2 = theme === 'LIGHT' ? 0xeaeef2 : 0x272a2c;
    const gridHelper = new THREE.GridHelper(3000, 300, gridColor1, gridColor2);
    gridHelper.rotation.x = Math.PI / 2;
    gridGroupRef.current.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(50);
    gridGroupRef.current.add(axesHelper);

    gridGroupRef.current.visible = gridEnabled;

    scene.add(gridGroupRef.current);
    scene.add(entityGroupRef.current);
    scene.add(textLodGroupRef.current);
    scene.add(highlightGroupRef.current);
    scene.add(previewGroupRef.current);
    scene.add(snapGroupRef.current);

    rebuildEntities();

    let animationFrameId: number;
    let lodKey = '';
    let lodChangedAt = 0;
    let lodDirty = false;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      // 화면 이동·확대가 멈춘 뒤(0.25초) 보이는 범위의 문자를 다시 그린다 (대용량 도면에서만 실제로 동작)
      const now = performance.now();
      const key = `${camera.position.x.toFixed(2)}|${camera.position.y.toFixed(2)}|${camera.zoom}|${camera.right - camera.left}|${camera.top - camera.bottom}`;
      if (key !== lodKey) { lodKey = key; lodChangedAt = now; lodDirty = true; }
      if (lodForceRef.current) { lodForceRef.current = false; lodDirty = true; lodChangedAt = now - 1000; }
      if (lodDirty && now - lodChangedAt > 250) { lodDirty = false; textLodRef.current(); }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      const asp = w / h;
      // 휴대폰을 돌려 가로세로 비율이 크게 바뀌면 도면 전체가 화면에 맞도록 다시 맞춘다
      if (lastAspectRef.current && Math.abs(asp / lastAspectRef.current - 1) > 0.25) {
        lastAspectRef.current = asp;
        rendererRef.current.setSize(w, h);
        cameraRef.current.left = (-(cameraRef.current.top - cameraRef.current.bottom) * asp) / 2;
        cameraRef.current.right = ((cameraRef.current.top - cameraRef.current.bottom) * asp) / 2;
        cameraRef.current.updateProjectionMatrix();
        zoomExtentsRef.current();
        return;
      }
      lastAspectRef.current = asp;
      // 화면 크기가 바뀌어도(패널 열림 등) 현재 보고 있는 세로 범위를 유지하고 가로만 맞춘다
      const viewH = cameraRef.current.top - cameraRef.current.bottom || frustumSize;
      cameraRef.current.left = (-viewH * asp) / 2;
      cameraRef.current.right = (viewH * asp) / 2;
      cameraRef.current.top = viewH / 2;
      cameraRef.current.bottom = -viewH / 2;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    // 창 크기뿐 아니라 컨테이너 자체의 크기 변화(휴대폰 회전, 주소창 표시/숨김)에도 맞춘다
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    if (resizeObserver && containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      cancelAnimationFrame(animationFrameId);
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // 테마 및 그리드 상태 동기화
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(theme === 'LIGHT' ? 0xf6f8fa : 0x181a1b);
    }
    if (gridGroupRef.current) {
      gridGroupRef.current.visible = gridEnabled;
    }
    rebuildEntities();
  }, [theme, gridEnabled, rebuildEntities]);

  // 도면 전체 화면 줌 핏 (Zoom Extents)
  const zoomExtents = useCallback(() => {
    const bbox = model.getBoundingBox();
    if (!bbox || !cameraRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    if (width === 0 || height === 0) return;
    const aspect = width / height;

    const marginFactor = 1.3;
    const targetWidth = bbox.width * marginFactor;
    const targetHeight = bbox.height * marginFactor;
    const frustumSize = Math.max(targetHeight, targetWidth / aspect, 20);

    cameraRef.current.position.set(bbox.centerX, bbox.centerY, 500);
    cameraRef.current.lookAt(bbox.centerX, bbox.centerY, 0);

    cameraRef.current.left = (-frustumSize * aspect) / 2;
    cameraRef.current.right = (frustumSize * aspect) / 2;
    cameraRef.current.top = frustumSize / 2;
    cameraRef.current.bottom = -frustumSize / 2;
    cameraRef.current.zoom = 1;
    cameraRef.current.updateProjectionMatrix();
    cameraRef.current.updateMatrixWorld();

    if (onLogMessage) {
      onLogMessage(`[화면 맞춤] 도면 크기: ${bbox.width.toFixed(1)} × ${bbox.height.toFixed(1)} mm`);
    }
  }, [model, onLogMessage]);
  zoomExtentsRef.current = zoomExtents;

  useEffect(() => {
    rebuildEntities();
    if (zoomTrigger) {
      zoomExtents();
    }
  }, [rebuildEntities, onModelChange, zoomTrigger, zoomExtents]);

  // 모드 변경 시 상태 초기화
  useEffect(() => {
    firstPointRef.current = null;
    areaPointsRef.current = [];
    clearPreview();
    if (onLogMessage) {
      if (mode === 'PAN') onLogMessage('명령: PAN (마우스를 드래그하여 화면을 이동하십시오)');
      else if (mode === 'LINE') onLogMessage('명령: LINE (시작점을 클릭하십시오)');
      else if (mode === 'CIRCLE') onLogMessage('명령: CIRCLE (원의 중심점을 클릭하십시오)');
      else if (mode === 'DIST') onLogMessage('명령: DIST (첫 번째 측정점을 클릭하십시오)');
      else if (mode === 'AREA') onLogMessage('명령: AREA (다각형의 꼭짓점들을 순서대로 클릭하고 우클릭으로 완료하십시오)');
      else onLogMessage('명령: SELECT (객체 선택 대기)');
    }
  }, [mode]);

  const clearPreview = () => {
    const group = previewGroupRef.current;
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if ('geometry' in obj) (obj as any).geometry.dispose();
      if ('material' in obj) (obj as any).material.dispose();
    }
    const snapGrp = snapGroupRef.current;
    while (snapGrp.children.length > 0) {
      const obj = snapGrp.children[0];
      snapGrp.remove(obj);
      if ('geometry' in obj) (obj as any).geometry.dispose();
      if ('material' in obj) (obj as any).material.dispose();
    }
  };

  // 마우스 이동 이벤트
  const handleMouseMove = (e: React.MouseEvent) => {
    // 팬 조작
    if (isPanningRef.current && cameraRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      const zoom = cameraRef.current.zoom;
      cameraRef.current.position.x -= dx / zoom;
      cameraRef.current.position.y += dy / zoom;
      cameraRef.current.updateMatrixWorld();
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // MOVE 모드 이동
    if (isMovingRef.current && mode === 'MOVE' && selectedEntityId) {
      let worldPt = screenToWorld(e.clientX, e.clientY);
      const deltaX = worldPt.x - moveStartRef.current.x;
      const deltaY = worldPt.y - moveStartRef.current.y;
      if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
        model.selectEntity(selectedEntityId);
        if (model.moveSelected(deltaX, deltaY)) {
          rebuildEntities();
          moveStartRef.current = worldPt;
          if (onModelChange) onModelChange();
        }
      }
      return;
    }

    let worldPt = screenToWorld(e.clientX, e.clientY);
    const snap = findSnapPoint(worldPt);

    if (snap) {
      worldPt = snap.point;
      setActiveSnap(snap);

      const snapGrp = snapGroupRef.current;
      while (snapGrp.children.length > 0) snapGrp.remove(snapGrp.children[0]);

      const size = 6 / (cameraRef.current?.zoom || 1);
      const boxGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(snap.point.x - size, snap.point.y - size, 1),
        new THREE.Vector3(snap.point.x + size, snap.point.y - size, 1),
        new THREE.Vector3(snap.point.x + size, snap.point.y + size, 1),
        new THREE.Vector3(snap.point.x - size, snap.point.y + size, 1)
      ]);
      const snapMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
      const snapMarker = new THREE.LineLoop(boxGeom, snapMat);
      snapMarker.renderOrder = 10;
      snapGrp.add(snapMarker);
    } else {
      setActiveSnap(null);
      while (snapGroupRef.current.children.length > 0) {
        snapGroupRef.current.remove(snapGroupRef.current.children[0]);
      }
    }

    // 직교 모드 적용
    if (orthoEnabled && firstPointRef.current && mode !== 'AREA') {
      const p1 = firstPointRef.current;
      const dx = Math.abs(worldPt.x - p1.x);
      const dy = Math.abs(worldPt.y - p1.y);
      if (dx > dy) {
        worldPt = { x: worldPt.x, y: p1.y };
      } else {
        worldPt = { x: p1.x, y: worldPt.y };
      }
    }

    setWorldMouse(worldPt);

    // 동적 미리보기 렌더링
    const prevGrp = previewGroupRef.current;

    if (mode === 'LINE' && firstPointRef.current) {
      while (prevGrp.children.length > 0) prevGrp.remove(prevGrp.children[0]);
      const p1 = firstPointRef.current;
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, p1.y, 0.5),
        new THREE.Vector3(worldPt.x, worldPt.y, 0.5)
      ]);
      const mat = new THREE.LineDashedMaterial({ color: 0x58a6ff, dashSize: 3, gapSize: 2 });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 4;
      prevGrp.add(line);
    } else if (mode === 'CIRCLE' && firstPointRef.current) {
      while (prevGrp.children.length > 0) prevGrp.remove(prevGrp.children[0]);
      const p1 = firstPointRef.current;
      const radius = Math.hypot(worldPt.x - p1.x, worldPt.y - p1.y);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const th = (i / 48) * Math.PI * 2;
        pts.push(new THREE.Vector3(p1.x + Math.cos(th) * radius, p1.y + Math.sin(th) * radius, 0.5));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: 0x58a6ff, dashSize: 3, gapSize: 2 });
      const circle = new THREE.LineLoop(geom, mat);
      circle.computeLineDistances();
      circle.renderOrder = 4;
      prevGrp.add(circle);
    } else if (mode === 'DIST' && firstPointRef.current) {
      while (prevGrp.children.length > 0) prevGrp.remove(prevGrp.children[0]);
      const p1 = firstPointRef.current;
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, p1.y, 0.5),
        new THREE.Vector3(worldPt.x, worldPt.y, 0.5)
      ]);
      const mat = new THREE.LineDashedMaterial({ color: 0x3fb950, dashSize: 4, gapSize: 2 });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 4;
      prevGrp.add(line);
    } else if (mode === 'AREA' && areaPointsRef.current.length > 0) {
      while (prevGrp.children.length > 0) prevGrp.remove(prevGrp.children[0]);
      const pts = [...areaPointsRef.current, worldPt];
      const vecPoints = pts.map(p => new THREE.Vector3(p.x, p.y, 0.5));
      vecPoints.push(new THREE.Vector3(pts[0].x, pts[0].y, 0.5));

      const lineGeom = new THREE.BufferGeometry().setFromPoints(vecPoints);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x3fb950, linewidth: 2 });
      const polyLine = new THREE.Line(lineGeom, lineMat);
      polyLine.renderOrder = 4;
      prevGrp.add(polyLine);
    }
  };

  // 마우스 클릭 이벤트
  const handleClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (suppressClickRef.current) return; // 드래그/핀치 직후에 생기는 클릭은 무시
    const pt = worldMouse;

    if (mode === 'SELECT') {
      // 가장 가까운 엔티티 검색
      const zoom = cameraRef.current?.zoom || 1;
      const hitRadius = 15 / zoom;
      let selected: CadEntity | null = null;
      let minD = hitRadius;

      for (const ent of model.getEntities()) {
        if (ent.type === 'LINE') {
          // 점과 선분 간 최단거리
          const l2 = Math.hypot(ent.end.x - ent.start.x, ent.end.y - ent.start.y) ** 2;
          let t = l2 === 0 ? 0 : ((pt.x - ent.start.x) * (ent.end.x - ent.start.x) + (pt.y - ent.start.y) * (ent.end.y - ent.start.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          const projX = ent.start.x + t * (ent.end.x - ent.start.x);
          const projY = ent.start.y + t * (ent.end.y - ent.start.y);
          const d = Math.hypot(pt.x - projX, pt.y - projY);
          if (d < minD) {
            minD = d;
            selected = ent;
          }
        } else if (ent.type === 'CIRCLE') {
          const dCenter = Math.hypot(pt.x - ent.center.x, pt.y - ent.center.y);
          const dRing = Math.abs(dCenter - ent.radius);
          if (dRing < minD) {
            minD = dRing;
            selected = ent;
          }
        } else if (ent.type === 'TEXT' || ent.type === 'POINT') {
          const d = Math.hypot(pt.x - ent.position.x, pt.y - ent.position.y);
          if (d < minD) {
            minD = d;
            selected = ent;
          }
        } else if (ent.type === 'HATCH') {
          // 채움: 채워진 영역 안쪽을 클릭하면 거리 0, 바깥이면 경계선까지의 최단거리 (짝수-홀수 규칙으로 내부 판정)
          let edgeD = Infinity;
          let inside = false;
          for (const loop of ent.loops) {
            for (let i = 0; i < loop.length; i++) {
              const a = loop[i];
              const b = loop[(i + 1) % loop.length];
              const abx = b.x - a.x;
              const aby = b.y - a.y;
              const l2 = abx * abx + aby * aby;
              const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / l2));
              edgeD = Math.min(edgeD, Math.hypot(pt.x - (a.x + t * abx), pt.y - (a.y + t * aby)));
              if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
            }
          }
          const d = inside && ent.solid ? 0 : edgeD;
          if (d < minD) {
            minD = d;
            selected = ent;
          }
        }
      }

      setSelectedEntityId(selected ? selected.id : null);
      if (onSelectEntity) onSelectEntity(selected);
      if (selected && onLogMessage) {
        if (selected.type === 'LINE') {
          const len = Math.hypot(selected.end.x - selected.start.x, selected.end.y - selected.start.y);
          onLogMessage(`선택됨: 선분 (길이: ${len.toFixed(2)}mm, 레이어: ${selected.layer})`);
        } else if (selected.type === 'CIRCLE') {
          onLogMessage(`선택됨: 원 (반지름: ${selected.radius.toFixed(2)}mm, 레이어: ${selected.layer})`);
        } else if (selected.type === 'TEXT') {
          onLogMessage(`선택됨: 문자 "${selected.text}" (높이: ${selected.height}mm)`);
        } else if (selected.type === 'HATCH') {
          onLogMessage(`선택됨: 채움(HATCH) (경계 ${selected.loops.length}개, 레이어: ${selected.layer})`);
        }
      }
    } else if (mode === 'LINE') {
      if (!firstPointRef.current) {
        firstPointRef.current = pt;
        if (onLogMessage) onLogMessage(`시작점: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) -> 다음 점을 클릭하십시오`);
      } else {
        const p1 = firstPointRef.current;
        model.addLine(p1, pt);
        rebuildEntities();
        if (onModelChange) onModelChange();
        if (onLogMessage) onLogMessage(`선분 완료: (${p1.x.toFixed(2)}, ${p1.y.toFixed(2)}) -> (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
        firstPointRef.current = pt;
      }
    } else if (mode === 'CIRCLE') {
      if (!firstPointRef.current) {
        firstPointRef.current = pt;
        if (onLogMessage) onLogMessage(`원 중심점: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) -> 반지름 끝점을 클릭하십시오`);
      } else {
        const p1 = firstPointRef.current;
        const radius = Math.hypot(pt.x - p1.x, pt.y - p1.y);
        model.addCircle(p1, radius);
        rebuildEntities();
        firstPointRef.current = null;
        clearPreview();
        if (onModelChange) onModelChange();
        if (onLogMessage) onLogMessage(`원 완료: 중심(${p1.x.toFixed(2)}, ${p1.y.toFixed(2)}), 반지름 ${radius.toFixed(2)}mm`);
      }
    } else if (mode === 'DIST') {
      if (!firstPointRef.current) {
        firstPointRef.current = pt;
        if (onLogMessage) onLogMessage(`첫 번째 측정점: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) -> 두 번째 측정점을 클릭하십시오`);
      } else {
        const p1 = firstPointRef.current;
        const result = CadModel.measure(p1, pt);
        firstPointRef.current = null;

        // 측정 결과 시각화 (두 점 사이의 치수선 표시 유지)
        const prevGrp = previewGroupRef.current;
        while (prevGrp.children.length > 0) prevGrp.remove(prevGrp.children[0]);

        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(p1.x, p1.y, 1),
          new THREE.Vector3(pt.x, pt.y, 1)
        ]);
        const mat = new THREE.LineBasicMaterial({ color: 0x3fb950, linewidth: 2 });
        const dimLine = new THREE.Line(geom, mat);
        dimLine.renderOrder = 6;
        prevGrp.add(dimLine);

        // 치수 라벨 스프라이트 추가
        const midX = (p1.x + pt.x) / 2;
        const midY = (p1.y + pt.y) / 2;
        const labelSprite = createTextSprite(`${result.distance} mm`, 3.5, '#3fb950');
        labelSprite.position.set(midX, midY, 1.2);
        labelSprite.renderOrder = 7;
        prevGrp.add(labelSprite);

        if (onMeasureComplete) onMeasureComplete(result);
        if (onLogMessage) {
          onLogMessage(`[DIST 측정] 거리: ${result.distance}mm | ΔX: ${result.deltaX}mm | ΔY: ${result.deltaY}mm | 각도: ${result.angleDeg}°`);
        }
      }
    } else if (mode === 'AREA') {
      areaPointsRef.current.push(pt);
      const count = areaPointsRef.current.length;
      if (onLogMessage) {
        onLogMessage(`꼭짓점 ${count} 지정됨: (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) - 우클릭하여 면적 계산 완료`);
      }
    }
  };

  // 마우스 커서 위치 중심 줌
  const zoomByFactor = useCallback((clientX: number, clientY: number, factor: number) => {
    if (!cameraRef.current || !containerRef.current) return;
    const camera = cameraRef.current;

    const beforeWorld = screenToWorld(clientX, clientY);
    const nextZoom = Math.max(0.001, Math.min(1000, camera.zoom * factor));
    camera.zoom = nextZoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const afterWorld = screenToWorld(clientX, clientY);
    camera.position.x += (beforeWorld.x - afterWorld.x);
    camera.position.y += (beforeWorld.y - afterWorld.y);
    camera.updateMatrixWorld();
  }, [screenToWorld]);

  const zoomAtMouse = useCallback((clientX: number, clientY: number, deltaY: number) => {
    zoomByFactor(clientX, clientY, deltaY < 0 ? 1.2 : 0.8333);
  }, [zoomByFactor]);

  // 네이티브 휠 리스너 (passive: false)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAtMouse(e.clientX, e.clientY, e.deltaY);
    };

    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onNativeWheel);
    };
  }, [zoomAtMouse]);

  // 터치 리스너와 외부 신호가 항상 최신 값을 쓰도록 매 렌더링마다 갱신
  modeRef.current = mode;
  selectedIdRef.current = selectedEntityId;
  const touchApiRef = useRef<any>(null);
  touchApiRef.current = { model, rebuildEntities, onModelChange };
  const finishRef = useRef<() => void>(() => {});
  finishRef.current = () => finishOrCancel();

  useEffect(() => {
    if (commandSignal && commandSignal.id > 0) finishRef.current();
  }, [commandSignal?.id]);

  // 터치 조작: 한 손가락 드래그 = 화면 이동(이동 모드에서 선택된 개체가 있으면 개체 이동),
  // 두 손가락 = 확대/축소 + 이동, 가볍게 탭 = 클릭(브라우저가 클릭 이벤트로 변환)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = touchRef.current;
    const DRAG_THRESHOLD = 8; // 이 거리(px)보다 많이 움직여야 드래그로 인정 (탭과 구분)
    let startPt = { x: 0, y: 0 };

    const toPts = (e: TouchEvent) => Array.from(e.touches).map(p => ({ x: p.clientX, y: p.clientY }));
    const dist = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const mid = (p: { x: number; y: number }[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });

    // 화면의 한 점을 prev에서 cur로 옮긴 만큼 도면을 따라 움직인다
    const panBy = (prev: { x: number; y: number }, cur: { x: number; y: number }) => {
      const cam = cameraRef.current;
      if (!cam) return;
      const before = screenToWorld(prev.x, prev.y);
      const after = screenToWorld(cur.x, cur.y);
      cam.position.x += before.x - after.x;
      cam.position.y += before.y - after.y;
      cam.updateMatrixWorld();
    };

    const onStart = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      t.pts = toPts(e);
      if (t.pts.length === 1) {
        t.moved = false;
        startPt = t.pts[0];
        t.moving = modeRef.current === 'MOVE' && !!selectedIdRef.current;
        if (t.moving) moveStartRef.current = screenToWorld(t.pts[0].x, t.pts[0].y);
      } else if (t.pts.length >= 2) {
        t.moved = true;
        t.moving = false;
        t.dist = dist(t.pts);
      }
    };

    const onMove = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      const pts = toPts(e);
      const prev = t.pts;
      if (pts.length >= 2 && prev.length >= 2) {
        e.preventDefault();
        const c = mid(pts);
        panBy(mid(prev), c);
        const d = dist(pts);
        if (t.dist > 0 && d > 0) zoomByFactor(c.x, c.y, d / t.dist);
        t.dist = d;
        t.moved = true;
      } else if (pts.length === 1 && prev.length === 1) {
        if (!t.moved && Math.hypot(pts[0].x - startPt.x, pts[0].y - startPt.y) < DRAG_THRESHOLD) return;
        e.preventDefault();
        t.moved = true;
        if (t.moving) {
          const api = touchApiRef.current;
          const w = screenToWorld(pts[0].x, pts[0].y);
          const dX = w.x - moveStartRef.current.x;
          const dY = w.y - moveStartRef.current.y;
          if (selectedIdRef.current && (Math.abs(dX) > 0.01 || Math.abs(dY) > 0.01)) {
            api.model.selectEntity(selectedIdRef.current);
            if (api.model.moveSelected(dX, dY)) {
              api.rebuildEntities();
              moveStartRef.current = w;
              if (api.onModelChange) api.onModelChange();
            }
          }
        } else {
          panBy(prev[0], pts[0]);
        }
      }
      t.pts = pts;
    };

    const onEnd = (e: TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      if (t.moved) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 350);
      }
      t.pts = toPts(e);
      if (t.pts.length === 1) startPt = t.pts[0]; // 두 손가락 중 하나만 떼면 남은 손가락으로 계속 이동
      if (t.pts.length === 0) t.moving = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [screenToWorld, zoomByFactor]);

  // 마우스 다운/업 (팬 제어, 이동 제어)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || (mode === 'PAN' && e.button === 0)) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
    } else if (mode === 'MOVE' && e.button === 0 && selectedEntityId) {
      isMovingRef.current = true;
      moveStartRef.current = worldMouse;
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || (mode === 'PAN' && e.button === 0)) {
      isPanningRef.current = false;
    } else if (mode === 'MOVE' && e.button === 0) {
      isMovingRef.current = false;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // 손가락을 오래 누를 때 생기는 가짜 우클릭은 무시한다 (모바일은 화면의 '완료/취소' 버튼을 사용)
    if (Date.now() - lastTouchTimeRef.current < 700) return;
    finishOrCancel();
  };

  // 우클릭(또는 모바일 '완료/취소' 버튼): AREA는 면적 계산 완료, 그 외는 진행 중인 명령 취소
  const finishOrCancel = () => {
    if (mode === 'AREA') {
      if (areaPointsRef.current.length >= 3) {
        const res = CadModel.measureArea(areaPointsRef.current);
        if (onAreaComplete) onAreaComplete(res);
        if (onLogMessage) {
          onLogMessage(`[AREA 면적 측정 완료] 면적: ${res.areaMm2.toLocaleString()} mm² (${res.areaM2} m²) | 둘레: ${res.perimeterMm} mm`);
        }
      } else {
        if (onLogMessage) onLogMessage('면적 계산을 위해서는 최소 3개 이상의 점이 필요합니다.');
      }
      areaPointsRef.current = [];
      clearPreview();
      return;
    }

    firstPointRef.current = null;
    clearPreview();
    if (onLogMessage) onLogMessage('*명령 취소됨*');
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: mode === 'PAN' ? (isPanningRef.current ? 'grabbing' : 'grab') : 'crosshair',
        overflow: 'hidden',
        touchAction: 'none' // 브라우저의 스크롤·확대 대신 직접 구현한 터치 조작을 쓴다
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* 화면 하단 실시간 AutoCAD 스타일 상태바 */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          backgroundColor: theme === 'LIGHT' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(24, 26, 27, 0.85)',
          color: theme === 'LIGHT' ? '#0969da' : '#4af626',
          fontFamily: 'monospace',
          fontSize: '12px',
          padding: '4px 12px',
          borderRadius: '4px',
          border: theme === 'LIGHT' ? '1px solid #d0d7de' : '1px solid #3f4448',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
          display: 'flex',
          gap: '15px'
        }}
      >
        <span>X: {worldMouse.x.toFixed(2)}</span>
        <span>Y: {worldMouse.y.toFixed(2)}</span>
        {activeSnap && (
          <span style={{ color: theme === 'LIGHT' ? '#1a7f37' : '#00ffff', fontWeight: 'bold' }}>
            SNAP: {activeSnap.type} ({activeSnap.point.x.toFixed(1)}, {activeSnap.point.y.toFixed(1)})
          </span>
        )}
      </div>
    </div>
  );
};

#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Drawing from 'dxf-writer';
import DxfParser from 'dxf-parser';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { execFileSync } from 'child_process';

const BIN_DIR = path.resolve(process.cwd(), 'bin');
const DWG2DXF_EXE = path.join(BIN_DIR, 'dwg2dxf.exe');

const ACI_COLOR_MAP = {
  1: '#FF0000', // Red (SHEET)
  2: '#FFFF00', // Yellow
  3: '#00FF00', // Green (AM_4)
  4: '#00FFFF', // Cyan
  5: '#0000FF', // Blue
  6: '#FF00FF', // Magenta
  7: '#FFFFFF', // White
  8: '#808080', // Dark Gray
  9: '#C0C0C0'  // Light Gray
};

// 에이전트 CLI 상태 저장 파일 경로 (세션 유지)
const STATE_FILE = path.join(process.cwd(), '.cad_agent_state.json');

/**
 * AutoCAD MTEXT 서식 제어 문자열을 순수 텍스트로 정제
 */
function cleanCadMText(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø');
  s = s.replace(/\\S([^;^]+)\^([^;]*);/gi, '$1/$2');
  s = s.replace(/\\[fF][^;]*;/g, '');
  s = s.replace(/\\[cChHwWqQaAtT][^;]*;/g, '');
  s = s.replace(/\\[pP]/g, ' ');
  s = s.replace(/\\[lLrRoOkK]/g, '');
  s = s.replace(/\\~/g, ' ');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\\\\/g, '\\');
  return s.trim();
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      // fallback
    }
  }
  return {
    layers: { '0': { name: '0', color: '#FFFFFF' } },
    entities: [],
    nextId: 1
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function computeBoundingBox(entities) {
  if (!entities || entities.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ent of entities) {
    if (ent.type === 'LINE' && ent.start && ent.end) {
      minX = Math.min(minX, ent.start.x, ent.end.x);
      minY = Math.min(minY, ent.start.y, ent.end.y);
      maxX = Math.max(maxX, ent.start.x, ent.end.x);
      maxY = Math.max(maxY, ent.start.y, ent.end.y);
    } else if (ent.type === 'CIRCLE' && ent.center && ent.radius) {
      minX = Math.min(minX, ent.center.x - ent.radius);
      minY = Math.min(minY, ent.center.y - ent.radius);
      maxX = Math.max(maxX, ent.center.x + ent.radius);
      maxY = Math.max(maxY, ent.center.y + ent.radius);
    } else if (ent.type === 'TEXT' && ent.position) {
      const h = ent.height || 2.5;
      const w = (ent.text?.length || 1) * h * 0.7;
      minX = Math.min(minX, ent.position.x);
      minY = Math.min(minY, ent.position.y);
      maxX = Math.max(maxX, ent.position.x + w);
      maxY = Math.max(maxY, ent.position.y + h);
    } else if (ent.type === 'HATCH' && Array.isArray(ent.loops)) {
      for (const loop of ent.loops) {
        for (const p of loop) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;

  return {
    minX: Number(minX.toFixed(4)),
    minY: Number(minY.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    maxY: Number(maxY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
    centerX: Number(((minX + maxX) / 2).toFixed(4)),
    centerY: Number(((minY + maxY) / 2).toFixed(4))
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
[CAD Agent Controller CLI v2.0]
사용법:
  node src/agent-cli.js open <filePath>             : CAD 파일(DWG, DXF) 열기 및 데이터 로드
  node src/agent-cli.js inspect                     : 현재 도면 엔티티 현황, 레이어 및 바운딩 박스 조회
  node src/agent-cli.js dist --p1 "x,y" --p2 "x,y"  : 두 점 간 실제 거리, Delta X/Y, 각도 수치 측정
  node src/agent-cli.js area --points "x1,y1;x2,y2;x3,y3" : 다각형 면적(m², mm²) 및 둘레 정밀 측정
  node src/agent-cli.js id --point "x,y"            : 지정한 점의 절대 좌표(WCS) 조회
  node src/agent-cli.js line --start "x,y" --end "x,y" [--layer "NAME"] : 선분(LINE) 추가
  node src/agent-cli.js circle --center "x,y" --radius "r" [--layer "NAME"] : 원(CIRCLE) 추가
  node src/agent-cli.js save --output <filePath>    : 도면을 AutoCAD/CADian 호환 DXF 파일로 저장
  node src/agent-cli.js clear                       : 현재 도면 세션 초기화
`);
    process.exit(0);
  }

  const state = loadState();

  switch (command) {
    case 'clear': {
      saveState({ layers: { '0': { name: '0', color: '#FFFFFF' } }, entities: [], nextId: 1 });
      console.log(JSON.stringify({ status: 'success', message: '도면 상태가 초기화되었습니다.' }, null, 2));
      break;
    }

    case 'open': {
      const filePath = args[1];
      if (!filePath || !fs.existsSync(filePath)) {
        console.error(JSON.stringify({ status: 'error', message: `파일을 찾을 수 없습니다: ${filePath}` }));
        process.exit(1);
      }

      const fileBuffer = fs.readFileSync(filePath);
      const isDwg = filePath.toLowerCase().endsWith('.dwg') ||
        (fileBuffer.length >= 6 && String.fromCharCode(...fileBuffer.subarray(0, 2)) === 'AC');

      state.entities = [];
      state.nextId = 1;
      state.layers = { '0': { name: '0', color: '#FFFFFF' } };
      state.skippedEntities = {}; // 표시하지 못한 개체 종류별 개수 (공용 파서가 채움)

      const ensureLayer = (lName, defaultColor = '#00FFFF') => {
        if (!state.layers[lName]) {
          state.layers[lName] = { name: lName, color: defaultColor };
        }
      };

      if (isDwg) {
        const tempDir = path.resolve(process.cwd(), '.cad_temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const currentSourceDwg = path.join(tempDir, '.current_source.dwg');
        try { fs.copyFileSync(filePath, currentSourceDwg); } catch (_) {}

        // 1순위: 웹 뷰어와 같은 공용 파서(dxf-json 기반)를 사용해 CLI와 뷰어의 결과를 일치시킨다.
        // 실패하면 아래의 기존 CLI 자체 파서로 대체한다. (파서가 CLI를 재호출하지 않도록 cliFallback: false)
        let parsedWithBinary = false;
        try {
          const { parseDwgIsolated } = await import('./core/dwg-parser-isolated.ts');
          const shared = parseDwgIsolated(fileBuffer, { cliFallback: false });
          if (shared.status === 'success' && Array.isArray(shared.entities)) {
            for (const [lName, color] of Object.entries(shared.layerColors || {})) ensureLayer(lName, color);
            for (const lName of shared.layers || []) ensureLayer(lName);
            state.entities = shared.entities;
            state.skippedEntities = shared.skippedEntities || {};
            state.nextId = shared.entities.length + 1;
            parsedWithBinary = true;
          }
        } catch (sharedErr) {
          console.warn('공용 파서 사용 실패, CLI 자체 파서로 대체합니다:', sharedErr?.message || sharedErr);
        }

        if (!parsedWithBinary && fs.existsSync(DWG2DXF_EXE)) {
          const tempDxf = path.join(tempDir, `cli_temp_${Date.now()}.dxf`);

          try {
            execFileSync(DWG2DXF_EXE, ['-v0', filePath, '-o', tempDxf], {
              encoding: 'utf-8',
              timeout: 30000,
              maxBuffer: 100 * 1024 * 1024
            });

            if (fs.existsSync(tempDxf) && fs.statSync(tempDxf).size > 0) {
              const currentBaseDxfPath = path.join(tempDir, '.current_base.dxf');
              try { fs.copyFileSync(tempDxf, currentBaseDxfPath); } catch (_) {}

              const dxfContent = fs.readFileSync(tempDxf, 'utf-8');
              const parser = new DxfParser();
              const parsed = parser.parseSync(dxfContent);

              if (parsed && Array.isArray(parsed.entities)) {
                if (parsed.tables?.layer?.layers) {
                  for (const [lName, lObj] of Object.entries(parsed.tables.layer.layers)) {
                    const cIdx = lObj.colorNumber || 7;
                    ensureLayer(lName, ACI_COLOR_MAP[cIdx] || '#00FFFF');
                  }
                }

                const blocks = parsed.blocks || {};
                const processEntity = (ent, transform) => {
                  const layer = ent.layer || '0';
                  ensureLayer(layer);

                  const tf = (pt) => {
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

                  if (ent.type === 'LINE' && ent.vertices && ent.vertices.length >= 2) {
                    const p1 = tf(ent.vertices[0]);
                    const p2 = tf(ent.vertices[1]);
                    state.entities.push({
                      id: `line_${state.nextId++}`,
                      type: 'LINE',
                      layer,
                      start: { x: Number(p1.x.toFixed(4)), y: Number(p1.y.toFixed(4)) },
                      end: { x: Number(p2.x.toFixed(4)), y: Number(p2.y.toFixed(4)) }
                    });
                  } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && ent.vertices.length >= 2) {
                    const pts = ent.vertices;
                    for (let i = 0; i < pts.length - 1; i++) {
                      const p1 = tf(pts[i]);
                      const p2 = tf(pts[i + 1]);
                      state.entities.push({
                        id: `line_${state.nextId++}`,
                        type: 'LINE',
                        layer,
                        start: { x: Number(p1.x.toFixed(4)), y: Number(p1.y.toFixed(4)) },
                        end: { x: Number(p2.x.toFixed(4)), y: Number(p2.y.toFixed(4)) }
                      });
                    }
                    if ((ent.shape || ent.closed) && pts.length > 2) {
                      const p1 = tf(pts[pts.length - 1]);
                      const p2 = tf(pts[0]);
                      state.entities.push({
                        id: `line_${state.nextId++}`,
                        type: 'LINE',
                        layer,
                        start: { x: Number(p1.x.toFixed(4)), y: Number(p1.y.toFixed(4)) },
                        end: { x: Number(p2.x.toFixed(4)), y: Number(p2.y.toFixed(4)) }
                      });
                    }
                  } else if (ent.type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
                    const c = tf(ent.center);
                    const scale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
                    state.entities.push({
                      id: `circle_${state.nextId++}`,
                      type: 'CIRCLE',
                      layer,
                      center: { x: Number(c.x.toFixed(4)), y: Number(c.y.toFixed(4)) },
                      radius: Number((ent.radius * scale).toFixed(4))
                    });
                  } else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
                    const c = tf(ent.center);
                    const scale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
                    const r = ent.radius * scale;
                    const rot = transform ? transform.rotationRad : 0;
                    const startAngle = (ent.startAngle || 0) + rot;
                    const endAngle = (ent.endAngle || Math.PI * 2) + rot;
                    const segs = 16;
                    let diff = endAngle - startAngle;
                    if (diff < 0) diff += Math.PI * 2;
                    const step = diff / segs;
                    let prevX = c.x + Math.cos(startAngle) * r;
                    let prevY = c.y + Math.sin(startAngle) * r;
                    for (let s = 1; s <= segs; s++) {
                      const ang = startAngle + step * s;
                      const curX = c.x + Math.cos(ang) * r;
                      const curY = c.y + Math.sin(ang) * r;
                      state.entities.push({
                        id: `line_${state.nextId++}`,
                        type: 'LINE',
                        layer,
                        start: { x: Number(prevX.toFixed(4)), y: Number(prevY.toFixed(4)) },
                        end: { x: Number(curX.toFixed(4)), y: Number(curY.toFixed(4)) }
                      });
                      prevX = curX;
                      prevY = curY;
                    }
                  } else if ((ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'ATTRIB' || ent.type === 'ATTDEF') && (ent.text || ent.string || ent.tag)) {
                    const raw = (typeof ent.text === 'object' ? ent.text?.text : ent.text) || ent.string || ent.tag || '';
                    const cleaned = cleanCadMText(raw);
                    if (cleaned) {
                      const pt = ent.startPoint || ent.insertionPoint || ent.position || { x: 0, y: 0 };
                      const pos = tf(pt);
                      const hScale = transform ? (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2 : 1;
                      state.entities.push({
                        id: `text_${state.nextId++}`,
                        type: 'TEXT',
                        layer,
                        text: cleaned,
                        position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)) },
                        height: Number(((ent.textHeight || ent.height || 2.5) * hScale).toFixed(4))
                      });
                    }
                  } else if (ent.type === 'INSERT' && ent.name && blocks[ent.name]) {
                    const blk = blocks[ent.name];
                    const insPos = tf(ent.position || { x: 0, y: 0 });
                    const scaleX = (ent.xScale || 1) * (transform ? transform.scaleX : 1);
                    const scaleY = (ent.yScale || 1) * (transform ? transform.scaleY : 1);
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
                };

                for (const ent of parsed.entities) {
                  processEntity(ent);
                }
                parsedWithBinary = true;
              }
            }
          } catch (binErr) {
            // fallback
          } finally {
            if (fs.existsSync(tempDxf)) try { fs.unlinkSync(tempDxf); } catch (_) {}
          }
        }

        if (!parsedWithBinary) {
        // LibreDwg WebAssembly 엔진으로 DWG 바이너리 파싱 (폴백)
        const wasmPath = path.resolve('node_modules/@mlightcad/libredwg-web/wasm');
        let libredwg = null;
        let dwg = null;

        try {
          libredwg = await LibreDwg.create(wasmPath);
          const uint8 = new Uint8Array(fileBuffer);
          dwg = libredwg.dwg_read_data(uint8, Dwg_File_Type.DWG);
          if (!dwg) throw new Error('dwg_read_data returned null');

          const db = libredwg.convert(dwg);
          if (!db) throw new Error('DWG database convert failed');

          const rawEntities = [];
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
            ensureLayer(layer, layer === '7' ? '#FFE873' : (layer === 'SHEET' ? '#3FB950' : '#00FFFF'));

            // 1. 선분
            const start = ent.startPoint || ent.start || (ent.vertices && ent.vertices[0]);
            const end = ent.endPoint || ent.end || (ent.vertices && ent.vertices[1]);
            if (ent.type === 'LINE' && start && end) {
              state.entities.push({
                id: `line_${state.nextId++}`,
                type: 'LINE',
                layer,
                start: { x: Number(start.x.toFixed(4)), y: Number(start.y.toFixed(4)) },
                end: { x: Number(end.x.toFixed(4)), y: Number(end.y.toFixed(4)) }
              });
            }
            // 2. 원
            else if (ent.type === 'CIRCLE' && (ent.center || ent.centerPoint) && typeof (ent.radius || ent.r) === 'number') {
              const c = ent.center || ent.centerPoint;
              const r = ent.radius || ent.r;
              state.entities.push({
                id: `circle_${state.nextId++}`,
                type: 'CIRCLE',
                layer,
                center: { x: Number(c.x.toFixed(4)), y: Number(c.y.toFixed(4)) },
                radius: Number(r.toFixed(4))
              });
            }
            // 3. 폴리라인
            else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && Array.isArray(ent.vertices) && ent.vertices.length >= 2) {
              const pts = ent.vertices;
              for (let i = 0; i < pts.length - 1; i++) {
                state.entities.push({
                  id: `line_${state.nextId++}`,
                  type: 'LINE',
                  layer,
                  start: { x: Number(pts[i].x.toFixed(4)), y: Number(pts[i].y.toFixed(4)) },
                  end: { x: Number(pts[i + 1].x.toFixed(4)), y: Number(pts[i + 1].y.toFixed(4)) }
                });
              }
              if ((ent.shape || ent.closed) && pts.length > 2) {
                state.entities.push({
                  id: `line_${state.nextId++}`,
                  type: 'LINE',
                  layer,
                  start: { x: Number(pts[pts.length - 1].x.toFixed(4)), y: Number(pts[pts.length - 1].y.toFixed(4)) },
                  end: { x: Number(pts[0].x.toFixed(4)), y: Number(pts[0].y.toFixed(4)) }
                });
              }
            }
            // 4. 호
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
                state.entities.push({
                  id: `line_${state.nextId++}`,
                  type: 'LINE',
                  layer,
                  start: { x: Number(prevX.toFixed(4)), y: Number(prevY.toFixed(4)) },
                  end: { x: Number(curX.toFixed(4)), y: Number(curY.toFixed(4)) }
                });
                prevX = curX;
                prevY = curY;
              }
            }
            // 5. 타원
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
                state.entities.push({
                  id: `line_${state.nextId++}`,
                  type: 'LINE',
                  layer,
                  start: { x: Number(prevX.toFixed(4)), y: Number(prevY.toFixed(4)) },
                  end: { x: Number(curX.toFixed(4)), y: Number(curY.toFixed(4)) }
                });
                prevX = curX;
                prevY = curY;
              }
            }
            // 6. 해치 (원형 단자 및 경계)
            else if (ent.type === 'HATCH' && Array.isArray(ent.boundaryPaths)) {
              for (const bp of ent.boundaryPaths) {
                for (const edge of bp.edges || []) {
                  if (edge.type === 2 && edge.center && typeof edge.radius === 'number') {
                    state.entities.push({
                      id: `circle_${state.nextId++}`,
                      type: 'CIRCLE',
                      layer,
                      center: { x: Number(edge.center.x.toFixed(4)), y: Number(edge.center.y.toFixed(4)) },
                      radius: Number(edge.radius.toFixed(4))
                    });
                  } else if (edge.type === 1 && edge.start && edge.end) {
                    state.entities.push({
                      id: `line_${state.nextId++}`,
                      type: 'LINE',
                      layer,
                      start: { x: Number(edge.start.x.toFixed(4)), y: Number(edge.start.y.toFixed(4)) },
                      end: { x: Number(edge.end.x.toFixed(4)), y: Number(edge.end.y.toFixed(4)) }
                    });
                  }
                }
              }
            }
            // 7. 텍스트 / MTEXT
            else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && (ent.text || ent.string)) {
              const cleaned = cleanCadMText(ent.text || ent.string || '');
              if (cleaned) {
                const pos = ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
                state.entities.push({
                  id: `text_${state.nextId++}`,
                  type: 'TEXT',
                  layer,
                  text: cleaned,
                  position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)) },
                  height: Number((ent.textHeight || ent.height || 2.5).toFixed(4))
                });
              }
            }
            // 8. ATTRIB
            else if (ent.type === 'ATTRIB') {
              const tObj = typeof ent.text === 'object' ? ent.text : null;
              const cleaned = cleanCadMText((tObj ? tObj.text : ent.text) || ent.string || '');
              if (cleaned) {
                const pos = (tObj ? tObj.startPoint : null) || ent.insertionPoint || ent.startPoint || ent.position || { x: 0, y: 0 };
                state.entities.push({
                  id: `text_${state.nextId++}`,
                  type: 'TEXT',
                  layer,
                  text: cleaned,
                  position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)) },
                  height: Number(((tObj ? tObj.textHeight : null) || ent.textHeight || ent.height || 2.5).toFixed(4))
                });
              }
            }
          }
        } finally {
          if (libredwg && dwg) {
            try { libredwg.dwg_free(dwg); } catch (_) {}
          }
        }
        }
      } else {
        // DXF 파일 파싱
        const content = fs.readFileSync(filePath, 'utf-8');
        const parser = new DxfParser();
        const parsed = parser.parseSync(content);

        for (const ent of parsed.entities || []) {
          const layer = ent.layer || '0';
          ensureLayer(layer);

          if (ent.type === 'LINE') {
            state.entities.push({
              id: `line_${state.nextId++}`,
              type: 'LINE',
              layer,
              start: { x: Number(ent.vertices[0].x.toFixed(4)), y: Number(ent.vertices[0].y.toFixed(4)) },
              end: { x: Number(ent.vertices[1].x.toFixed(4)), y: Number(ent.vertices[1].y.toFixed(4)) }
            });
          } else if (ent.type === 'CIRCLE') {
            state.entities.push({
              id: `circle_${state.nextId++}`,
              type: 'CIRCLE',
              layer,
              center: { x: Number(ent.center.x.toFixed(4)), y: Number(ent.center.y.toFixed(4)) },
              radius: Number(ent.radius.toFixed(4))
            });
          } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
            const cleaned = cleanCadMText(ent.text || ent.string || '');
            if (cleaned) {
              const pos = ent.startPoint || ent.position || { x: 0, y: 0 };
              state.entities.push({
                id: `text_${state.nextId++}`,
                type: 'TEXT',
                layer,
                text: cleaned,
                position: { x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)) },
                height: Number((ent.textHeight || ent.height || 2.5).toFixed(4))
              });
            }
          }
        }
      }

      saveState(state);
      const bbox = computeBoundingBox(state.entities);

      console.log(JSON.stringify({
        status: 'success',
        openedFile: filePath,
        format: isDwg ? 'DWG (AutoCAD Binary)' : 'DXF (AutoCAD Drawing Interchange)',
        totalEntities: state.entities.length,
        lines: state.entities.filter(e => e.type === 'LINE').length,
        circles: state.entities.filter(e => e.type === 'CIRCLE').length,
        texts: state.entities.filter(e => e.type === 'TEXT').length,
        hatches: state.entities.filter(e => e.type === 'HATCH').length,
        skippedEntities: state.skippedEntities || {},
        layers: Object.keys(state.layers),
        boundingBox: bbox
      }, null, 2));
      break;
    }

    case 'inspect': {
      const bbox = computeBoundingBox(state.entities);
      console.log(JSON.stringify({
        status: 'success',
        totalEntities: state.entities.length,
        lines: state.entities.filter(e => e.type === 'LINE').length,
        circles: state.entities.filter(e => e.type === 'CIRCLE').length,
        texts: state.entities.filter(e => e.type === 'TEXT').length,
        hatches: state.entities.filter(e => e.type === 'HATCH').length,
        skippedEntities: state.skippedEntities || {},
        layers: state.layers,
        boundingBox: bbox,
        sampleEntities: state.entities.slice(0, 10)
      }, null, 2));
      break;
    }

    case 'dist': {
      let p1Str = '', p2Str = '';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--p1') p1Str = args[i + 1];
        if (args[i] === '--p2') p2Str = args[i + 1];
      }
      if (!p1Str || !p2Str) {
        console.error(JSON.stringify({ status: 'error', message: '--p1 "x,y" 및 --p2 "x,y" 인자가 필요합니다.' }));
        process.exit(1);
      }
      const [x1, y1] = p1Str.split(',').map(Number);
      const [x2, y2] = p2Str.split(',').map(Number);

      const deltaX = x2 - x1;
      const deltaY = y2 - y1;
      const distance = Math.hypot(deltaX, deltaY);
      let angleRad = Math.atan2(deltaY, deltaX);
      if (angleRad < 0) angleRad += Math.PI * 2;
      const angleDeg = (angleRad * 180) / Math.PI;

      console.log(JSON.stringify({
        status: 'success',
        command: 'DIST',
        p1: { x: x1, y: y1 },
        p2: { x: x2, y: y2 },
        distance: Number(distance.toFixed(4)),
        deltaX: Number(deltaX.toFixed(4)),
        deltaY: Number(deltaY.toFixed(4)),
        angleDeg: Number(angleDeg.toFixed(2))
      }, null, 2));
      break;
    }

    case 'area': {
      let ptsStr = '';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--points') ptsStr = args[i + 1];
      }
      if (!ptsStr) {
        console.error(JSON.stringify({ status: 'error', message: '--points "x1,y1;x2,y2;x3,y3" 인자가 필요합니다.' }));
        process.exit(1);
      }
      const points = ptsStr.split(';').map(pair => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });

      if (points.length < 3) {
        console.error(JSON.stringify({ status: 'error', message: '면적 계산에는 최소 3개 이상의 좌표점이 필요합니다.' }));
        process.exit(1);
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

      console.log(JSON.stringify({
        status: 'success',
        command: 'AREA',
        pointsCount: points.length,
        points,
        areaMm2: Number(areaMm2.toFixed(4)),
        areaM2: Number(areaM2.toFixed(6)),
        perimeterMm: Number(perimeter.toFixed(4))
      }, null, 2));
      break;
    }

    case 'id': {
      let ptStr = '';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--point') ptStr = args[i + 1];
      }
      if (!ptStr) {
        console.error(JSON.stringify({ status: 'error', message: '--point "x,y" 인자가 필요합니다.' }));
        process.exit(1);
      }
      const [x, y] = ptStr.split(',').map(Number);
      console.log(JSON.stringify({
        status: 'success',
        command: 'ID',
        point: { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), z: 0 }
      }, null, 2));
      break;
    }

    case 'line': {
      let startStr = '', endStr = '', layer = '0';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--start') startStr = args[i + 1];
        if (args[i] === '--end') endStr = args[i + 1];
        if (args[i] === '--layer') layer = args[i + 1];
      }
      if (!startStr || !endStr) {
        console.error(JSON.stringify({ status: 'error', message: '--start "x,y" 및 --end "x,y" 인자가 필요합니다.' }));
        process.exit(1);
      }
      const [x1, y1] = startStr.split(',').map(Number);
      const [x2, y2] = endStr.split(',').map(Number);

      const id = `line_${state.nextId++}`;
      const newEntity = {
        id,
        type: 'LINE',
        layer,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 }
      };
      state.entities.push(newEntity);
      if (!state.layers[layer]) state.layers[layer] = { name: layer, color: '#FFFFFF' };
      saveState(state);

      console.log(JSON.stringify({ status: 'success', entity: newEntity }, null, 2));
      break;
    }

    case 'circle': {
      let centerStr = '', radiusStr = '', layer = '0';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--center') centerStr = args[i + 1];
        if (args[i] === '--radius') radiusStr = args[i + 1];
        if (args[i] === '--layer') layer = args[i + 1];
      }
      if (!centerStr || !radiusStr) {
        console.error(JSON.stringify({ status: 'error', message: '--center "x,y" 및 --radius "r" 인자가 필요합니다.' }));
        process.exit(1);
      }
      const [cx, cy] = centerStr.split(',').map(Number);
      const radius = Number(radiusStr);

      const id = `circle_${state.nextId++}`;
      const newEntity = {
        id,
        type: 'CIRCLE',
        layer,
        center: { x: cx, y: cy },
        radius
      };
      state.entities.push(newEntity);
      if (!state.layers[layer]) state.layers[layer] = { name: layer, color: '#FFFFFF' };
      saveState(state);

      console.log(JSON.stringify({ status: 'success', entity: newEntity }, null, 2));
      break;
    }

    case 'save': {
      let outputPath = '';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--output') outputPath = args[i + 1];
      }
      if (!outputPath) {
        console.error(JSON.stringify({ status: 'error', message: '--output <filePath> 인자가 필요합니다.' }));
        process.exit(1);
      }

      const d = new Drawing();
      d.setUnits('Millimeters');

      // 개체 색 유지 모듈 (dxf-writer는 레이어 색만 지원하므로 개체별 트루컬러를 따로 기록)
      const { shapeCount, applyEntityColor } = await import('./core/dxf-entity-color.ts');
      const layerAci = (hex) => ({
        '#FF0000': Drawing.ACI.RED, '#00FF00': Drawing.ACI.GREEN, '#0000FF': Drawing.ACI.BLUE,
        '#00FFFF': Drawing.ACI.CYAN, '#FFFF00': Drawing.ACI.YELLOW, '#FF00FF': Drawing.ACI.MAGENTA
      })[String(hex || '').toUpperCase()] ?? Drawing.ACI.WHITE;

      for (const lName of Object.keys(state.layers)) {
        d.addLayer(lName, layerAci(state.layers[lName].color), 'CONTINUOUS');
      }

      for (const ent of state.entities) {
        d.setActiveLayer(ent.layer || '0');
        const shapesBefore = shapeCount(d);
        if (ent.type === 'LINE') {
          d.drawLine(ent.start.x, ent.start.y, ent.end.x, ent.end.y);
        } else if (ent.type === 'CIRCLE') {
          d.drawCircle(ent.center.x, ent.center.y, ent.radius);
        } else if (ent.type === 'TEXT') {
          // 문자 기준점(anchor)과 회전을 DXF 정렬/회전으로 저장 (없으면 왼쪽 기준선)
          const a = ent.anchor;
          const hAlign = a ? (a.x >= 0.75 ? 'right' : a.x >= 0.25 ? 'center' : 'left') : 'left';
          const vAlign = a ? (a.y >= 0.75 ? 'top' : a.y >= 0.25 ? 'middle' : 'baseline') : 'baseline';
          d.drawText(ent.position.x, ent.position.y, ent.height || 2.5, ent.rotation || 0, ent.text, hAlign, vAlign);
        } else if (ent.type === 'HATCH' && Array.isArray(ent.loops)) {
          // HATCH는 구버전(R12 계열) DXF에 안전하게 쓸 수 없어, 경계선을 닫힌 폴리라인으로 저장 (채움은 저장되지 않음)
          for (const loop of ent.loops) {
            if (loop.length >= 3) d.drawPolyline(loop.map(p => [p.x, p.y]), true);
          }
        }
        // 개체 색 유지 (레이어 색과 다를 때만 트루컬러 기록)
        applyEntityColor(d, shapesBefore, ent.color, state.layers[ent.layer || '0']?.color);
      }

      const resultDxf = d.toDxfString();

      if (outputPath.toLowerCase().endsWith('.dwg')) {
        // DWG 저장은 지원하지 않는다 (LibreDWG가 만든 DWG는 개체가 대량 유실되거나 FastView에서 열리지 않음)
        console.error(JSON.stringify({ status: 'error', message: 'DWG 저장은 지원하지 않습니다. 출력 파일 확장자를 .dxf로 지정하세요.' }));
        process.exit(1);
      }
      fs.writeFileSync(outputPath, resultDxf, 'utf-8');
      console.log(JSON.stringify({
        status: 'success',
        savedFile: outputPath,
        entitiesWritten: state.entities.length,
        bytes: resultDxf.length,
        format: 'DXF (dxf-writer 생성, HATCH는 채움 없이 경계선 폴리라인으로 저장)'
      }, null, 2));
      break;
    }

    default:
      console.error(JSON.stringify({ status: 'error', message: `알 수 없는 명령어: ${command}` }));
      process.exit(1);
  }
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', message: err.message || String(err) }));
  process.exit(1);
});

// 큰 DWG용 변환기: LibreDWG 원본 프로그램(dwg2dxf.exe)으로 DXF를 만들고,
// 그 DXF를 한 줄씩 흘려 읽으며(메모리에 통째로 올리지 않음) "가벼운 도면(cadlite)" 이진 데이터로 줄인다.
//   사용: node dwg_lite.js <입력.dwg> <출력.cadlite>      (또는 require('./dwg_lite').convert)
// cadlite 형식: [4바이트 JSON 길이(LE)] [JSON 머리글] [Float32 좌표 묶음들(x,y 쌍)]
//   머리글 = { origin:[ox,oy], bounds:{min,max}, fit:{min,max}, layers:[{name,aci,off}],
//             groups:[{layer,aci,offset,count}],   // count = 부동소수 개수(선분 1개 = 4개), offset = Float32 번호
//             texts:[{x,y,h,rot,s,layer,aci,mt}], stats:{...} }
// 블록(INSERT)은 한 번만 펼쳐 둔 조각을 변환 행렬로 복사해 붙인다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DWG2DXF = path.join(__dirname, '..', 'bin', 'libredwg', 'dwg2dxf.exe');
const MARK = String.fromCharCode(0);        // 블록 안 "레이어 0" 표식: 삽입할 때 INSERT 의 레이어로 바뀐다

// ── 1) DWG → DXF (원본 LibreDWG, 별도 프로세스) ──────────────────────────
function dwgToDxf(dwgPath, dxfPath, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DWG2DXF)) return reject(new Error('bin/libredwg/dwg2dxf.exe 가 없습니다.'));
    try { fs.unlinkSync(dxfPath); } catch (e) {}
    const p = spawn(DWG2DXF, ['-y', '-o', dxfPath, dwgPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d.toString(); });
    const timer = setTimeout(() => { p.kill(); reject(new Error('DWG 변환 시간 초과')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (fs.existsSync(dxfPath) && fs.statSync(dxfPath).size > 100) return resolve();   // 경고(Warning)만 있어도 결과가 있으면 성공
      reject(new Error(`dwg2dxf 실패(코드 ${code}): ${err.trim().slice(-300)}`));
    });
  });
}

// ── 2) DXF 한 줄씩 읽기 (코드/값 쌍) ──────────────────────────────────────
// dwg2dxf 는 긴 MTEXT 안에 단독 줄바꿈을 쓰는 경우가 있어, 코드 자리에 숫자가 아닌 줄이 오면 앞 값의 이어짐으로 본다.
const isCode = (s) => /^\s*-?\d{1,4}\s*$/.test(s);

async function* pairs(dxfPath) {
  const stream = fs.createReadStream(dxfPath, { highWaterMark: 4 * 1024 * 1024 });
  const dec = new TextDecoder('utf-8');
  let rest = '', code = null, pending = null;
  const feed = function* (line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (code === null) {
      if (isCode(line)) code = parseInt(line, 10);
      else if (pending) pending.v += '\n' + line;            // 값의 이어짐
    } else {
      if (pending) yield pending;                            // 다음 줄이 이어짐일 수 있어 한 쌍 늦게 내보낸다
      pending = { c: code, v: line };
      code = null;
    }
  };
  for await (const buf of stream) {
    const lines = (rest + dec.decode(buf, { stream: true })).split('\n');
    rest = lines.pop();
    for (const line of lines) yield* feed(line);
  }
  if (rest) yield* feed(rest);
  if (pending) yield pending;
}

// ── 3) 기하 도우미 ───────────────────────────────────────────────────────
const D2R = Math.PI / 180;

class SegBuf {                       // 자라는 버퍼 (좌표 정밀도를 위해 Float64, 파일에 쓸 때 원점을 빼고 Float32)
  constructor(cap = 1 << 16) { this.a = new Float64Array(cap); this.n = 0; }
  push4(x1, y1, x2, y2) {
    if (this.n + 4 > this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a, n = this.n;
    a[n] = x1; a[n + 1] = y1; a[n + 2] = x2; a[n + 3] = y2; this.n = n + 4;
  }
}

// 변환 행렬 [a,b,c,d,e,f] : x' = a*x + c*y + e,  y' = b*x + d*y + f
const IDENT = [1, 0, 0, 1, 0, 0];
const FLIP = [-1, 0, 0, 1, 0, 0];
function mul(m, n) {                 // n 을 먼저, m 을 나중에 적용 (m∘n)
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
          m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
          m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function insertMatrix(e) {           // INSERT: 크기 → 회전 → 이동
  const sx = e.sx ?? 1, sy = e.sy ?? 1, r = (e.rot || 0) * D2R, c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, e.x || 0, e.y || 0];
}
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function arcPoints(cx, cy, r, a0, a1) {
  let span = a1 - a0;
  while (span <= 0) span += 2 * Math.PI;
  const n = Math.max(8, Math.min(96, Math.ceil(span / (Math.PI / 24))));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = a0 + span * i / n; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
}
function bulgeArc(p1, p2, b) {       // 두 점 사이 bulge 호의 중간 점들 (양 끝 제외)
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [];
  const theta = 4 * Math.atan(b), rad = chord / (2 * Math.sin(theta / 2));
  const alpha = Math.atan2(dy, dx), gamma = (Math.PI - theta) / 2;
  const beta = alpha + (b > 0 ? (Math.PI / 2 - gamma) : -(Math.PI / 2 - gamma));
  const cx = p1[0] + Math.abs(rad) * Math.cos(beta), cy = p1[1] + Math.abs(rad) * Math.sin(beta);
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx), a1 = Math.atan2(p2[1] - cy, p2[0] - cx);
  let span = a1 - a0;
  if (b > 0 && span < 0) span += 2 * Math.PI; else if (b < 0 && span > 0) span -= 2 * Math.PI;
  const n = Math.max(2, Math.min(32, Math.ceil(Math.abs(span) / (Math.PI / 16))));
  const out = [];
  for (let i = 1; i < n; i++) { const t = a0 + span * i / n; out.push([cx + Math.abs(rad) * Math.cos(t), cy + Math.abs(rad) * Math.sin(t)]); }
  return out;
}

// ── 4) 변환 본체 ─────────────────────────────────────────────────────────
async function dxfToLite(dxfPath, onProgress) {
  const layerTable = new Map();            // name → {aci, off}
  const blocks = new Map();                // name → {base:[x,y], ents:[...], compiled}
  const model = [];                        // ENTITIES 구역의 개체들 (모형 공간)
  const paper = [];                        // 배치(종이) 공간 개체: 축척이 달라 모형 공간과 섞으면 글자가 거대해지고 범위가 늘어나므로 따로 둔다
  const stats = { entities: 0, inserts: 0, skipped: {} };

  // 4-1) 개체 모으기 (구역 / 표 / 블록 / 개체 상태기계)
  let section = null, table = null, curBlock = null, ent = null, tblRec = null, inPoly = null, curAttrOwner = null;
  const push = (e) => { (curBlock ? curBlock.ents : (e.ps ? paper : model)).push(e); };
  const finishEnt = () => {
    if (!ent) return;
    const e = ent; ent = null;
    stats.entities++;
    if (e.type === 'POLYLINE') { inPoly = e; return; }
    if (e.type === 'VERTEX') { if (inPoly) inPoly.verts.push({ x: e.x, y: e.y, b: e.bulge || 0, f: e.f70 || 0 }); return; }
    if (e.type === 'SEQEND') { if (inPoly) { push(inPoly); inPoly = null; } curAttrOwner = null; return; }
    if (e.type === 'ATTRIB' && curAttrOwner) { curAttrOwner.attribs.push(e); return; }
    if (e.type === 'INSERT') curAttrOwner = e; else if (e.type !== 'ATTRIB') curAttrOwner = null;
    push(e);
  };

  let n = 0;
  for await (const { c, v } of pairs(dxfPath)) {
    if ((++n & 0xfffff) === 0 && onProgress) onProgress(n);
    if (c === 0) {
      if (v === 'SECTION') { finishEnt(); continue; }
      if (v === 'ENDSEC') { finishEnt(); section = null; table = null; continue; }
      if (section === 'TABLES') {
        if (v === 'TABLE') { tblRec = null; continue; }
        if (v === 'ENDTAB') { tblRec = null; table = null; continue; }
        tblRec = { type: v, name: null, aci: 7, off: false };
        if (v === 'LAYER') table = 'LAYER';
        continue;
      }
      if (section === 'BLOCKS') {
        if (v === 'BLOCK') { finishEnt(); curBlock = { name: null, base: [0, 0], ents: [] }; continue; }
        if (v === 'ENDBLK') { finishEnt(); if (curBlock && curBlock.name != null) blocks.set(curBlock.name, curBlock); curBlock = null; inPoly = null; curAttrOwner = null; continue; }
      }
      if (section === 'ENTITIES' || section === 'BLOCKS') {
        finishEnt();
        ent = { type: v, layer: '0', aci: 256, x: 0, y: 0, pts: [], verts: [], attribs: [] };
      }
      continue;
    }
    if (section === null) {                                    // SECTION 다음 이름
      if (c === 2) section = (v === 'TABLES' || v === 'BLOCKS' || v === 'ENTITIES') ? v : 'SKIP';
      continue;
    }
    if (section === 'TABLES') {
      if (!tblRec) continue;
      if (c === 2) { tblRec.name = v; if (table === 'LAYER') layerTable.set(v, tblRec); }
      else if (c === 62) { const a = parseInt(v, 10); tblRec.aci = Math.abs(a); if (a < 0) tblRec.off = true; }
      continue;
    }
    if (section === 'BLOCKS' && curBlock && !ent) {            // BLOCK 머리글
      if (c === 2 && curBlock.name == null) curBlock.name = v;
      else if (c === 10) curBlock.base[0] = parseFloat(v);
      else if (c === 20) curBlock.base[1] = parseFloat(v);
      continue;
    }
    if (!ent) continue;
    switch (c) {
      case 8: ent.layer = v; break;
      case 62: ent.aci = parseInt(v, 10); break;
      case 67: ent.ps = parseInt(v, 10) === 1; break;           // 1 = 배치(종이) 공간
      case 230: ent.nz = parseFloat(v); break;
      case 2: ent.name = v; break;
      case 1: case 3: ent.s = (ent.s || '') + v; break;        // MTEXT 는 3(앞 조각들) → 1(마지막) 순서
      case 10:
        if (ent.type === 'LWPOLYLINE' || ent.type === 'SPLINE') ent.pts.push({ x: parseFloat(v), y: 0, b: 0 }); else ent.x = parseFloat(v);
        break;
      case 20:
        if (ent.type === 'LWPOLYLINE' || ent.type === 'SPLINE') { const l = ent.pts[ent.pts.length - 1]; if (l) l.y = parseFloat(v); } else ent.y = parseFloat(v);
        break;
      case 42:
        if (ent.type === 'LWPOLYLINE') { const l = ent.pts[ent.pts.length - 1]; if (l) l.b = parseFloat(v); }
        else if (ent.type === 'VERTEX') ent.bulge = parseFloat(v);
        else ent.sy = parseFloat(v);                           // INSERT 의 Y 배율 / ELLIPSE 끝 각도
        break;
      case 11: ent.x2 = parseFloat(v); break;
      case 21: ent.y2 = parseFloat(v); break;
      case 12: ent.x3 = parseFloat(v); break;
      case 22: ent.y3 = parseFloat(v); break;
      case 13: ent.x4 = parseFloat(v); break;
      case 23: ent.y4 = parseFloat(v); break;
      case 40: ent.r = parseFloat(v); break;
      case 41: if (ent.type === 'INSERT') ent.sx = parseFloat(v); else ent.p41 = parseFloat(v); break;
      case 44: ent.dx = parseFloat(v); break;
      case 45: ent.dy = parseFloat(v); break;
      case 50: ent.rot = parseFloat(v); break;
      case 51: ent.a1 = parseFloat(v); break;
      case 70: ent.f70 = parseInt(v, 10); break;
      case 71: ent.f71 = parseInt(v, 10); break;
      case 72: ent.f72 = parseInt(v, 10); break;
      case 73: ent.f73 = parseInt(v, 10); break;
      default: break;
    }
  }
  finishEnt();

  // 4-2) 개체 → 선분 (블록은 한 번만 펼쳐 두고 INSERT 마다 변환해 복사)
  const aciOf = (e, ctx) => {                              // 색: 256 BYLAYER, 0 BYBLOCK(= -1 표식)
    const a = e.aci;
    if (a === 0) return ctx.aci;
    if (a === 256 || a === undefined || Number.isNaN(a)) {
      const lay = (e.layer === '0' && ctx.layer) ? ctx.layer : e.layer;
      if (lay === MARK) return -2;                         // 블록 안 레이어 0 의 '레이어 색' = 삽입할 때 정해짐
      const l = layerTable.get(lay);
      return l ? l.aci : 7;
    }
    return Math.abs(a);
  };
  const layerOf = (e, ctx) => (e.layer === '0' && ctx.layer) ? ctx.layer : e.layer;
  function resolveAci(a, layer, ctx) {                      // -1 BYBLOCK → 삽입 색, -2 레이어 색 → 정해진 레이어의 색
    if (a === -1) return ctx.aci;
    if (a === -2) { if (layer === MARK) return -2; const l = layerTable.get(layer); return l ? l.aci : 7; }
    return a;
  }

  const makeSink = () => ({ segs: new Map(), texts: [] });
  const segOf = (sink, layer, aci) => {
    const k = layer + '\u0001' + aci; let s = sink.segs.get(k);
    if (!s) { s = { layer, aci, buf: new SegBuf() }; sink.segs.set(k, s); }
    return s.buf;
  };
  const emitPoly = (sink, layer, aci, pts, closed, M) => {
    if (pts.length < 2) return;
    const buf = segOf(sink, layer, aci);
    let prev = ap(M, pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const cur = ap(M, pts[i][0], pts[i][1]);
      buf.push4(prev[0], prev[1], cur[0], cur[1]); prev = cur;
    }
    if (closed) { const f = ap(M, pts[0][0], pts[0][1]); buf.push4(prev[0], prev[1], f[0], f[1]); }
  };
  const polyWithBulge = (verts, closed) => {
    const out = [];
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i], w = verts[(i + 1) % verts.length];
      out.push([v.x, v.y]);
      if (v.b && (i < verts.length - 1 || closed)) for (const q of bulgeArc([v.x, v.y], [w.x, w.y], v.b)) out.push(q);
    }
    return out;
  };

  const compiling = new Set();
  function compileBlock(name) {
    const blk = blocks.get(name);
    if (!blk) return null;
    if (blk.compiled) return blk.compiled;
    if (compiling.has(name)) return null;                  // 자기 자신을 부르는 블록 방지
    compiling.add(name);
    const sink = makeSink();
    const ctx = { layer: MARK, aci: -1 };                  // 레이어 0·BYBLOCK 은 표식으로 남겨 삽입 때 정한다
    for (const e of blk.ents) processEnt(e, sink, ctx, [1, 0, 0, 1, -blk.base[0], -blk.base[1]], 0);
    compiling.delete(name);
    blk.compiled = sink;
    return sink;
  }
  function insertBlock(name, sink, ctx, M, depth, IM) {
    if (depth > 12) return;
    const comp = compileBlock(name);
    if (!comp) return;
    const T = mul(M, IM);
    for (const seg of comp.segs.values()) {
      const layer = seg.layer === MARK ? ctx.layer : seg.layer;
      const aci = resolveAci(seg.aci, layer, ctx);
      const buf = segOf(sink, layer, aci), a = seg.buf.a, cnt = seg.buf.n;
      for (let i = 0; i < cnt; i += 4) {
        buf.push4(T[0] * a[i] + T[2] * a[i + 1] + T[4], T[1] * a[i] + T[3] * a[i + 1] + T[5],
                  T[0] * a[i + 2] + T[2] * a[i + 3] + T[4], T[1] * a[i + 2] + T[3] * a[i + 3] + T[5]);
      }
    }
    const sc = Math.hypot(T[0], T[1]), ang = Math.atan2(T[1], T[0]) / D2R;
    for (const t of comp.texts) {
      const [x, y] = ap(T, t.x, t.y);
      const layer = t.layer === MARK ? ctx.layer : t.layer;
      sink.texts.push({ x, y, h: t.h * sc, rot: t.rot + ang, s: t.s, layer, aci: resolveAci(t.aci, layer, ctx), mt: t.mt });
    }
  }

  const OCS = new Set(['ARC', 'CIRCLE', 'LWPOLYLINE', 'INSERT', 'TEXT', 'SOLID', 'ATTRIB']);
  function processEnt(e, sink, ctx, M, depth) {
    if (e.nz < 0 && OCS.has(e.type)) M = mul(M, FLIP);        // 압출 방향이 아래(-Z)면 X 를 뒤집어 그림
    const layer = layerOf(e, ctx) || '0';
    const aci = aciOf(e, ctx);
    switch (e.type) {
      case 'LINE': {
        const p = ap(M, e.x, e.y), q = ap(M, e.x2 ?? e.x, e.y2 ?? e.y);
        segOf(sink, layer, aci).push4(p[0], p[1], q[0], q[1]); break;
      }
      case 'LWPOLYLINE': {
        const closed = !!((e.f70 || 0) & 1);
        emitPoly(sink, layer, aci, polyWithBulge(e.pts, closed), closed, M); break;
      }
      case 'POLYLINE': {
        if ((e.f70 || 0) & (16 | 64)) break;                   // 3D 메쉬·폴리페이스는 건너뜀
        const closed = !!((e.f70 || 0) & 1);
        const vs = e.verts.filter((v) => !((v.f || 0) & 16));
        if (vs.length) emitPoly(sink, layer, aci, polyWithBulge(vs, closed), closed, M); break;
      }
      case 'CIRCLE': emitPoly(sink, layer, aci, arcPoints(e.x, e.y, e.r, 0, 2 * Math.PI), false, M); break;
      case 'ARC': emitPoly(sink, layer, aci, arcPoints(e.x, e.y, e.r, (e.rot || 0) * D2R, (e.a1 ?? 360) * D2R), false, M); break;
      case 'ELLIPSE': {
        const mx = e.x2 || 0, my = e.y2 || 0, ratio = e.r ?? 1, a0 = e.p41 ?? 0, a1 = e.sy ?? (2 * Math.PI);
        let span = a1 - a0; while (span <= 0) span += 2 * Math.PI;
        const nn = Math.max(16, Math.min(96, Math.ceil(span / (Math.PI / 24))));
        const pts = [];
        for (let i = 0; i <= nn; i++) {
          const t = a0 + span * i / nn, ct = Math.cos(t), st = Math.sin(t);
          pts.push([e.x + mx * ct - my * ratio * st, e.y + my * ct + mx * ratio * st]);
        }
        emitPoly(sink, layer, aci, pts, false, M); break;
      }
      case 'SPLINE': {
        if (e.pts.length >= 2) emitPoly(sink, layer, aci, e.pts.map((p) => [p.x, p.y]), !!((e.f70 || 0) & 1), M); break;
      }
      case 'SOLID': case 'TRACE':                              // 3·4번째 점 순서가 뒤바뀌어 있음
        emitPoly(sink, layer, aci, [[e.x, e.y], [e.x2, e.y2], [e.x4 ?? e.x3, e.y4 ?? e.y3], [e.x3, e.y3]], true, M); break;
      case '3DFACE':
        emitPoly(sink, layer, aci, [[e.x, e.y], [e.x2, e.y2], [e.x3, e.y3], [e.x4 ?? e.x3, e.y4 ?? e.y3]], true, M); break;
      case 'TEXT': case 'MTEXT': case 'ATTRIB': {
        if (e.type === 'ATTRIB' && ((e.f70 || 0) & 1)) break;  // 숨김 속성
        const aligned = e.type !== 'MTEXT' && ((e.f72 || 0) || (e.f73 || 0)) && e.x2 !== undefined;   // 맞춤 글자는 11번 점이 실제 위치
        const [tx, ty] = aligned ? ap(M, e.x2, e.y2) : ap(M, e.x, e.y);
        let rot = e.rot || 0;
        if (e.type === 'MTEXT' && e.x2 !== undefined && e.y2 !== undefined && !e.rot) rot = Math.atan2(e.y2, e.x2) / D2R;
        sink.texts.push({ x: tx, y: ty, h: (e.r || 2.5) * Math.hypot(M[0], M[1]), rot: rot + Math.atan2(M[1], M[0]) / D2R, s: e.s || '', layer, aci, mt: e.type === 'MTEXT' ? 1 : 0 });
        break;
      }
      case 'DIMENSION':                                        // 치수는 모양을 그려 둔 익명 블록(*D…)을 삽입
        if (e.name) insertBlock(e.name, sink, { layer, aci }, M, depth + 1, IDENT);
        break;
      case 'INSERT': {
        stats.inserts++;
        const IM = insertMatrix(e);
        const cols = Math.min(50, Math.max(1, e.f70 || 1)), rows = Math.min(50, Math.max(1, e.f71 || 1));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          insertBlock(e.name, sink, { layer, aci }, M, depth + 1, mul(IM, [1, 0, 0, 1, c * (e.dx || 0), r * (e.dy || 0)]));
        }
        for (const a of e.attribs) processEnt(a, sink, { layer, aci }, M, depth + 1);
        break;
      }
      default: stats.skipped[e.type] = (stats.skipped[e.type] || 0) + 1;
    }
  }

  const out = makeSink();
  const rootCtx = { layer: null, aci: 7 };
  let k = 0;
  const drawList = model.length ? model : paper;                // 모형 공간이 비어 있으면 배치 공간을 그린다
  stats.paperSpace = paper.length;
  for (const e of drawList) {
    processEnt(e, out, rootCtx, IDENT, 0);
    if ((++k & 0xffff) === 0 && onProgress) onProgress(-k);
  }
  return { out, layerTable, stats };
}

// ── 5) 이진 파일로 쓰기 ──────────────────────────────────────────────────
function finalize(res, srcName) {
  const { out, layerTable, stats } = res;
  // 원점(좌표 정밀도 확보)과 "맞춤" 범위(멀리 떨어진 점 몇 개가 화면 맞춤을 망치지 않게 0.3~99.7%)
  const sx = [], sy = [];
  for (const g of out.segs.values()) {
    const a = g.buf.a, cnt = g.buf.n, step = Math.max(4, Math.floor(cnt / 4 / 5000) * 4);
    for (let i = 0; i < cnt; i += step) { sx.push(a[i]); sy.push(a[i + 1]); }
  }
  sx.sort((p, q) => p - q); sy.sort((p, q) => p - q);
  const pick = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))] : 0;
  const ox = pick(sx, 0.5), oy = pick(sy, 0.5);
  const fit = { min: [pick(sx, 0.003) - ox, pick(sy, 0.003) - oy], max: [pick(sx, 0.997) - ox, pick(sy, 0.997) - oy] };

  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, total = 0, offset = 0;
  const groups = [], bufs = [], layersUsed = new Set();
  for (const g of out.segs.values()) {
    const a = g.buf.a, cnt = g.buf.n, dst = new Float32Array(cnt);
    for (let i = 0; i < cnt; i += 2) {
      const x = a[i] - ox, y = a[i + 1] - oy;
      dst[i] = x; dst[i + 1] = y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    groups.push({ layer: g.layer, aci: g.aci, offset, count: cnt });
    bufs.push(dst); offset += cnt; total += cnt / 4;
    layersUsed.add(g.layer);
  }
  for (const t of out.texts) layersUsed.add(t.layer);
  const layers = [];
  for (const name of layersUsed) { const l = layerTable.get(name); layers.push({ name, aci: l ? l.aci : 7, off: !!(l && l.off) }); }
  for (const [name, l] of layerTable) if (!layersUsed.has(name)) layers.push({ name, aci: l.aci, off: !!l.off, empty: true });

  const texts = out.texts.map((t) => ({ x: +(t.x - ox).toFixed(3), y: +(t.y - oy).toFixed(3), h: +t.h.toFixed(3), rot: +t.rot.toFixed(1), s: t.s, layer: t.layer, aci: t.aci, mt: t.mt }));
  const head = {
    version: 1, source: srcName, origin: [ox, oy],
    bounds: { min: [minx, miny], max: [maxx, maxy] }, fit, layers, groups, texts,
    stats: { ...stats, segments: total, texts: texts.length, groups: groups.length }
  };
  let jsonStr = JSON.stringify(head);
  while ((4 + Buffer.byteLength(jsonStr, 'utf8')) % 4 !== 0) jsonStr += ' ';       // Float32 구역이 4바이트 경계에서 시작하도록 공백으로 채움
  const json = Buffer.from(jsonStr, 'utf8');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(json.length, 0);
  const body = Buffer.concat(bufs.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)));
  return { buffer: Buffer.concat([lenBuf, json, body]), head };
}

async function convert(dwgPath, litePath, onProgress) {
  const dxfPath = litePath + '.tmp.dxf';
  try {
    await dwgToDxf(dwgPath, dxfPath);
    const res = await dxfToLite(dxfPath, onProgress);
    const { buffer, head } = finalize(res, path.basename(dwgPath));
    await fs.promises.writeFile(litePath, buffer);
    return head.stats;
  } finally {
    try { await fs.promises.unlink(dxfPath); } catch (e) {}
  }
}

module.exports = { convert, dwgToDxf, dxfToLite, finalize };

if (require.main === module) {
  const [, , i, o] = process.argv;
  if (!i || !o) { console.error('사용: node dwg_lite.js <입력.dwg> <출력.cadlite>'); process.exit(1); }
  const t0 = Date.now();
  convert(i, o, (c) => process.stderr.write(`\r처리 중 ${Math.abs(c).toLocaleString()}   `))
    .then((s) => { console.log(`\n완료 ${((Date.now() - t0) / 1000).toFixed(1)}초`, JSON.stringify(s)); })
    .catch((e) => { console.error('\n실패:', e.message); process.exit(1); });
}

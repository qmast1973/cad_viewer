/* 도구 모음: 글자 찾기 · 거리/면적/좌표 측정 · 영역 확대/이전 보기 · 글꼴 · 도면층 관리 보강 · PNG 내보내기
 * DWG FastView 의 기능 구성(찾기·측정·도면층 관리·글꼴 대체·보기·내보내기)을 참고해 새로 만든 것이다. 코드·그림은 가져오지 않았다.
 * 큰 도면(cadlite) 모드에서 동작한다. 에이전트는 window.cadTools 로 같은 기능을 부른다 (스킬 cad-viewer 참고). */
(function () {
  'use strict';
  const A = () => (window.cadViewer && window.cadViewer.app) || null;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cadtools.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cadtools.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  const css = `
  .floating-tools{position:absolute;left:12px;bottom:40px;display:flex;flex-direction:column;gap:4px;background:var(--panel-bg);padding:5px;border-radius:8px;border:1px solid var(--panel-border);backdrop-filter:blur(8px);z-index:12;box-shadow:0 4px 12px rgba(0,0,0,.25)}
  .floating-tools .btn{width:46px;height:30px;padding:0;font-size:11px}
  #cad-tools-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6}
  #cad-panel{position:absolute;left:68px;bottom:40px;width:320px;max-height:62%;display:none;flex-direction:column;gap:6px;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;padding:10px;z-index:13;backdrop-filter:blur(10px);box-shadow:0 6px 18px rgba(0,0,0,.3);font-size:12px}
  #cad-panel.open{display:flex}
  #cad-panel h4{font-size:13px;display:flex;justify-content:space-between;align-items:center}
  #cad-panel input[type=text],#cad-panel select{height:28px;border-radius:6px;border:1px solid var(--panel-border);background:var(--btn-bg);color:var(--text-main);padding:0 8px;font-size:12px;width:100%;user-select:text}
  #cad-panel label{display:flex;align-items:center;gap:6px;color:var(--text-muted)}
  #cad-panel .row{display:flex;gap:6px;align-items:center}
  #cad-panel .list{overflow-y:auto;max-height:240px;display:flex;flex-direction:column;gap:2px}
  #cad-panel .item{padding:4px 6px;border-radius:4px;cursor:pointer;display:flex;gap:6px;line-height:1.35}
  #cad-panel .item:hover,#cad-panel .item.cur{background:var(--btn-hover)}
  #cad-panel .item small{color:var(--text-muted);white-space:nowrap}
  #cad-panel .muted{color:var(--text-muted)}
  .layer-extra{display:flex;align-items:center;gap:4px;margin-left:auto}
  .layer-extra input[type=range]{width:54px}
  .layer-extra button{border:1px solid var(--panel-border);background:var(--btn-bg);color:var(--text-main);border-radius:4px;font-size:10px;height:20px;padding:0 4px;cursor:pointer}
  #installBtn{white-space:nowrap;flex-shrink:0;padding:0 10px;font-size:12px}
  @media (max-width:480px){#sampleSelect{max-width:96px}}
  #tp-info{position:absolute;left:50%;top:58px;transform:translateX(-50%);display:none;max-width:calc(100% - 300px);min-width:150px;padding:6px 12px;border-radius:14px;background:var(--panel-bg);border:1px solid var(--panel-border);color:var(--text-main);font-size:12.5px;line-height:1.35;text-align:center;z-index:14;pointer-events:none;backdrop-filter:blur(8px)}
  @media (max-width:520px){#tp-info{max-width:calc(100% - 24px);top:auto;bottom:118px}}
  #tp-cur{position:absolute;display:none;width:60px;height:60px;margin:-30px 0 0 -30px;pointer-events:none;z-index:13}
  #tp-loupe{position:absolute;top:60px;display:none;width:132px;height:132px;border-radius:50%;border:3px solid #ffd400;box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:16;background:#101114;pointer-events:none}
  #tp-bar{position:absolute;left:50%;bottom:52px;transform:translateX(-50%);display:none;gap:10px;z-index:15}
  #tp-bar button{white-space:nowrap;height:46px;padding:0 15px;font-size:14.5px;border-radius:23px;border:1px solid var(--panel-border);background:var(--accent-color,#0a84ff);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.4)}
  #tp-bar button.sub{background:var(--panel-bg);color:var(--text-main)}
  @media (max-width:640px){#cad-panel{left:60px;width:calc(100% - 72px)}}`;

  function boot() {
    const app = A();
    if (!app || app._toolsReady) return;
    app._toolsReady = true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const view = $('viewport-container');
    const cv = document.createElement('canvas'); cv.id = 'cad-tools-overlay'; view.appendChild(cv);

    // ── 설정(글꼴) ──
    app.textFont = store.get('font', '"Malgun Gothic", "맑은 고딕"');
    app.textScale = store.get('scale', 1);
    app.textsOn = store.get('textsOn', true);
    app.textFixed = store.get('fixed', false);                    // 확대해도 글자 크기 고정(선택, 기본은 캐드처럼 도면과 같이 커지고 작아짐)

    const T = {
      tool: null,                 // null | 'dist' | 'path' | 'area' | 'coord' | 'zoomwin'
      pts: [], hover: null, records: [],
      find: { q: '', opts: { cs: false, word: false, wild: false, skipHidden: true }, res: [], cur: -1 },
      views: [], dirty: true, sig: ''
    };
    const isLite = () => !!app.lite;
    const toast = (m) => { const t = $('loading-text'); const ind = $('loading-indicator'); if (!ind) return; t.textContent = m; ind.style.display = 'flex'; setTimeout(() => { ind.style.display = 'none'; }, 1600); };
    const origin = () => (app.lite ? app.lite.head.origin : [0, 0]);

    // ── 좌표 변환 ──
    const V = new THREE.Vector3();
    const size = () => ({ W: app.container.clientWidth, H: app.container.clientHeight });
    function w2s(x, y) { const { W, H } = size(); V.set(x, y, 0).project(app.camera); return [(V.x + 1) / 2 * W, (1 - V.y) / 2 * H]; }
    function s2w(px, py) {
      const { W, H } = size(); app.camera.updateMatrixWorld();
      const p = new THREE.Vector3((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(app.camera);
      const d = p.sub(app.camera.position).normalize();
      const t = -app.camera.position.z / (d.z || 1e-9);
      return [app.camera.position.x + d.x * t, app.camera.position.y + d.y * t];
    }
    function pxPerUnit() {
      const dist = app.camera.position.distanceTo(app.controls.target);
      return size().H / (2 * dist * Math.tan(app.camera.fov * Math.PI / 360));
    }

    // ── 보기: 이전 보기, 이동, 영역 확대 ──
    function snapView() { return { t: app.controls.target.clone(), p: app.camera.position.clone() }; }
    function pushView() { T.views.push(snapView()); if (T.views.length > 40) T.views.shift(); }
    app.controls.addEventListener('start', pushView);
    function prevView() {
      const v = T.views.pop();
      if (!v) { toast('이전 보기가 없습니다'); return false; }
      app.controls.target.copy(v.t); app.camera.position.copy(v.p); app.controls.update(); app.textsDirty = true; T.dirty = true; return true;
    }
    function farFor(dist) { const b = app.fitBox; const m = b ? Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 10) : 1000; return Math.max(dist * 1000, m * 20); }
    function moveTo(cx, cy, dist) {
      pushView();
      app.controls.target.set(cx, cy, 0); app.camera.position.set(cx, cy, dist); app.camera.up.set(0, 1, 0);
      app.camera.near = dist / 100; app.camera.far = farFor(dist); app.camera.updateProjectionMatrix();
      app.controls.update(); app.textsDirty = true; T.dirty = true;
    }
    function zoomWindow(x1, y1, x2, y2) {
      const { W, H } = size(); const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      if (rw < 1e-9 && rh < 1e-9) return;
      const hw = Math.max(rh, rw * H / W) * 1.08;
      moveTo((x1 + x2) / 2, (y1 + y2) / 2, hw / (2 * Math.tan(app.camera.fov * Math.PI / 360)));
    }
    function zoomToText(t) {
      const { H } = size(); const px = Math.min(60, H / 8);
      const dist = H * Math.max(t.h, 0.01) / (2 * px * Math.tan(app.camera.fov * Math.PI / 360));
      moveTo(t.x, t.y, dist);
    }

    // ── 찾기 ──
    function compile(q, o) {
      if (!q) return null;
      let src = o.wild ? q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (o.word) src = '(^|[^\\p{L}\\p{N}_])(' + src + ')($|[^\\p{L}\\p{N}_])';
      try { return new RegExp(src, o.cs ? 'u' : 'iu'); } catch (e) { return null; }
    }
    function find(q, opts) {
      if (opts) Object.assign(T.find.opts, opts);
      T.find.q = q; T.find.res = []; T.find.cur = -1;
      const re = compile(q, T.find.opts);
      if (re && app.lite) {
        app.lite.texts.forEach((t, i) => {
          if (T.find.opts.skipHidden) { const l = app.layers.get(t.layer); if (l && !l.visible) return; }
          if (t._l === undefined) t._l = app.cleanCadLines(t.s);
          const s = t._l.join(' ');
          if (s && re.test(s)) T.find.res.push(i);
        });
      }
      T.dirty = true; renderPanel(); return T.find.res.length;
    }
    function findGo(step) {
      const f = T.find; if (!f.res.length) return -1;
      f.cur = (f.cur + step + f.res.length) % f.res.length;
      zoomToText(app.lite.texts[f.res[f.cur]]); renderPanel(); return f.cur;
    }

    // ── 측정 ──
    const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
    function polyLen(p, closed) { let s = 0; for (let i = 1; i < p.length; i++) s += dist2(p[i - 1], p[i]); if (closed && p.length > 2) s += dist2(p[p.length - 1], p[0]); return s; }
    function addRecord(r) { T.records.push(r); renderPanel(); T.dirty = true; }
    function measureDist(a, b) { // a,b = 도면 좌표(원점 더한 값 아님: 화면 좌표계). 입력은 절대 도면 좌표
      const o = origin(); const p = [a[0] - o[0], a[1] - o[1]], q = [b[0] - o[0], b[1] - o[1]];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const r = { type: '거리', value: Math.hypot(dx, dy), dx, dy, angle: Math.atan2(dy, dx) * 180 / Math.PI, pts: [p, q] };
      addRecord(r); return r;
    }
    function measureArea(abs) {
      const o = origin(); const p = abs.map((a) => [a[0] - o[0], a[1] - o[1]]);
      const r = { type: '면적', value: polyArea(abs), perimeter: polyLen(abs, true), pts: p };
      addRecord(r); return r;
    }
    function coordAt(a) { const o = origin(); const r = { type: '좌표', x: a[0], y: a[1], pts: [[a[0] - o[0], a[1] - o[1]]] }; addRecord(r); return r; }

    // ── 스냅: 끝점(□) · 중점(△) · 교차점(×). 커서 둘레의 선분만 모아서 계산한다(큰 도면에서도 클릭마다 수십 ms) ──
    const SNAP = { on: store.get('snapOn', true), end: store.get('snapEnd', true), mid: store.get('snapMid', true), int: store.get('snapInt', true) };
    const SNAP_NAME = { end: '끝점', mid: '중점', int: '교차' };
    /* (wx,wy) 둘레 r 안에 걸치는 선분을 [x1,y1,x2,y2] 로 모은다(최대 cap 개). v2 인스턴스는 삽입 변환을 적용한다. */
    function nearSegments(wx, wy, r, cap) {
      const out = [];
      const x0 = wx - r, x1 = wx + r, y0 = wy - r, y1 = wy + r;
      for (const L of app.lite.lines) {
        if (out.length >= cap) break;
        if (!L.obj.parent || !L.obj.parent.visible) continue;
        const a = L.obj.geometry.attributes.position.array;
        if (L.inst) {
          const { A, B, n, bb } = L.inst;
          for (let k = 0; k < n && out.length < cap; k++) {
            const ma = A[k * 3], mc = A[k * 3 + 1], me = A[k * 3 + 2], mb = B[k * 3], md = B[k * 3 + 1], mf = B[k * 3 + 2];
            let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
            for (let c = 0; c < 4; c++) {
              const px = c & 1 ? bb[2] : bb[0], py = c & 2 ? bb[3] : bb[1];
              const tx = ma * px + mc * py + me, ty = mb * px + md * py + mf;
              if (tx < bx0) bx0 = tx; if (tx > bx1) bx1 = tx; if (ty < by0) by0 = ty; if (ty > by1) by1 = ty;
            }
            if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) continue;
            for (let i = 0; i + 3 < a.length && out.length < cap; i += 4) {
              const ax = ma * a[i] + mc * a[i + 1] + me, ay = mb * a[i] + md * a[i + 1] + mf;
              const bx = ma * a[i + 2] + mc * a[i + 3] + me, by = mb * a[i + 2] + md * a[i + 3] + mf;
              if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
              out.push([ax, ay, bx, by]);
            }
          }
          continue;
        }
        for (let i = 0; i + 3 < a.length && out.length < cap; i += 4) {
          const ax = a[i], ay = a[i + 1], bx = a[i + 2], by = a[i + 3];
          if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
          out.push([ax, ay, bx, by]);
        }
      }
      return out;
    }
    function segCross(p, q) {                                  // 두 선분의 교점(끝에서 만나는 것도 포함), 없으면 null
      const d1x = p[2] - p[0], d1y = p[3] - p[1], d2x = q[2] - q[0], d2y = q[3] - q[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) return null;
      const t = ((q[0] - p[0]) * d2y - (q[1] - p[1]) * d2x) / den;
      const u = ((q[0] - p[0]) * d1y - (q[1] - p[1]) * d1x) / den;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
      return [p[0] + d1x * t, p[1] + d1y * t];
    }
    /* 스냅 후보: {p:[x,y], type:'end'|'mid'|'int'} 또는 null. 끝점·교차점을 중점보다 약간 우선한다. */
    function snapAt(wx, wy, rw, hover) {
      if (!app.lite || !SNAP.on) return null;
      const segs = nearSegments(wx, wy, rw * 1.2, hover ? 250 : 700);
      let best = null, bd = Infinity;
      const tryP = (x, y, type, w) => {
        const dx = x - wx, dy = y - wy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > rw) return;
        const sc = d * w;
        if (sc < bd) { bd = sc; best = { p: [x, y], type }; }
      };
      for (const sg of segs) {
        if (SNAP.end) { tryP(sg[0], sg[1], 'end', 1); tryP(sg[2], sg[3], 'end', 1); }
        if (SNAP.mid) tryP((sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2, 'mid', 1.25);
      }
      if (SNAP.int && segs.length > 1) {
        const n = Math.min(segs.length, hover ? 120 : 300);
        for (let i = 0; i < n; i++) {
          const p = segs[i];
          for (let j = i + 1; j < n; j++) {
            const q = segs[j];
            if (Math.max(p[0], p[2]) < Math.min(q[0], q[2]) || Math.max(q[0], q[2]) < Math.min(p[0], p[2]) || Math.max(p[1], p[3]) < Math.min(q[1], q[3]) || Math.max(q[1], q[3]) < Math.min(p[1], p[3])) continue;
            const c = segCross(p, q);
            if (c) tryP(c[0], c[1], 'int', 1.05);
          }
        }
      }
      return best;
    }
    function snapPoint(wx, wy, rw) { const r = snapAt(wx, wy, rw, false); return r ? r.p : null; }       // (이전 이름 유지)
    // ── 부품(블록) 선택: 도면에 들어 있는 부품 목록(objs: 이름·도면층·범위·핸들)에서 커서 아래 것을 고른다. 서버 없이 웹·폰에서도 된다. ──
    const S = { objs: null, src: null, sel: [], pt: null, cand: [], ci: 0 };
    function objsList() {
      if (!app.lite) return [];
      if (S.src !== app.lite) { S.src = app.lite; S.sel = []; S.pt = null; S.cand = []; S.objs = (app.lite.head.objs || []).map((r) => ({ n: r[0], l: r[1], x0: r[2], y0: r[3], x1: r[4], y1: r[5], h: r[6] })); }
      return S.objs;
    }
    const objSize = (o) => [o.x1 - o.x0, o.y1 - o.y0];
    function selCandidates(wx, wy, tol) {
      const out = [];
      for (const o of objsList()) {
        if (wx < o.x0 - tol || wx > o.x1 + tol || wy < o.y0 - tol || wy > o.y1 + tol) continue;
        const lay = app.layers.get(o.l); if (lay && !lay.visible) continue;
        out.push(o);
      }
      out.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));      // 작은 것(안쪽 부품)부터
      return out;
    }
    /* (wx,wy) 도면 지역 좌표에서 부품을 고른다. 같은 자리를 다시 누르면 겹친 다음 부품(순환), add 이면 목록에 더하거나 뺀다. */
    function selectAt(wx, wy, add) {
      if (!app.lite) return null;
      if (!(app.lite.head.objs && app.lite.head.objs.length)) { toast('이 도면에는 부품 정보가 없습니다(다시 열어 보세요)'); return null; }
      const tol = 3 / pxPerUnit();
      const c = selCandidates(wx, wy, tol);
      const same = S.pt && Math.hypot(wx - S.pt[0], wy - S.pt[1]) < 4 / pxPerUnit() && S.cand.length === c.length;
      S.pt = [wx, wy]; S.cand = c;
      if (!c.length) { if (!add) S.sel = []; T.dirty = true; renderPanel(); return null; }
      S.ci = same ? (S.ci + 1) % c.length : 0;
      const pick = c[S.ci];
      if (add) { const k = S.sel.indexOf(pick); if (k >= 0) S.sel.splice(k, 1); else S.sel.push(pick); }
      else S.sel = [pick];
      T.dirty = true; renderPanel();
      return pick;
    }
    function selInfo(o) { const [w, h] = objSize(o), org = origin(); return { name: o.n, layer: o.l, handle: String(o.h), x: o.x0 + org[0], y: o.y0 + org[1], width: w, height: h }; }
    function selZoom() {
      if (!S.sel.length) return false;
      const x0 = Math.min(...S.sel.map((o) => o.x0)), y0 = Math.min(...S.sel.map((o) => o.y0)), x1 = Math.max(...S.sel.map((o) => o.x1)), y1 = Math.max(...S.sel.map((o) => o.y1));
      zoomWindow(x0, y0, x1, y1); return true;
    }
    let bigCache = { lite: null, big: false };
    const isBig = () => { if (!app.lite) return false; if (bigCache.lite !== app.lite) bigCache = { lite: app.lite, big: totalVerts() >= 8e6 }; return bigCache.big; };
    const totalVerts = () => (app.lite ? app.lite.lines.reduce((n, l) => n + l.obj.geometry.attributes.position.count * (l.inst ? l.inst.n : 1), 0) : 0);

    function pickPoint(px, py, forceSnap, radiusPx) {
      const [wx, wy] = s2w(px, py);
      const rw = (radiusPx || 14) / pxPerUnit();
      const r = snapAt(wx, wy, rw, !forceSnap);                // 큰 도면도 스냅 표시(끌 때)는 하되, 호출 간격을 늘려 부담을 줄인다(isBig)
      return { p: r ? r.p : [wx, wy], snapped: !!r, type: r ? r.type : null };
    }
    function absOf(p) { const o = origin(); return [p[0] + o[0], p[1] + o[1]]; }

    function finishPath() {
      if (T.pts.length >= 2) {
        const abs = T.pts.map(absOf), o = origin();
        addRecord({ type: '길이', value: polyLen(abs, false), pts: abs.map((a) => [a[0] - o[0], a[1] - o[1]]) });
      } else toast('점이 2개 이상 필요합니다');
      T.pts = []; T.hover = null; T.dirty = true;
    }
    function finishArea() {
      if (T.pts.length >= 3) measureArea(T.pts.map(absOf));
      else toast('점이 3개 이상 필요합니다');
      T.pts = []; T.hover = null; T.dirty = true;
    }
    function onClick(px, py, shift, forced) {
      if (!T.tool || !isLite()) return;
      if (T.tool === 'sel') { const [wx, wy] = s2w(px, py); selectAt(wx, wy, !!shift); return; }
      const p = forced || pickPoint(px, py, true).p;
      if (T.tool === 'edit') { editClick(p); T.dirty = true; return; }
      if (T.tool === 'dist') {
        T.pts.push(p);
        if (T.pts.length === 2) { measureDist(absOf(T.pts[0]), absOf(T.pts[1])); T.pts = []; T.hover = null; }
      } else if (T.tool === 'area' || T.tool === 'path') T.pts.push(p);
      else if (T.tool === 'coord') coordAt(absOf(p));
      T.dirty = true; renderPanel();
    }


    // ── 부품(블록) 이동·복사 편집 (이 PC 서버 필요: 원본은 그대로, 결과는 '저장/' 폴더의 새 DXF) ──
    const E = { ready: false, busy: '', sel: null, ops: [], step: 'idle', op: null, base: null, hover: null, saved: null, msg: '편집을 시작하려면 [편집 준비]를 누르세요', info: null };
    const localServer = () => /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    async function api(cmd, body, raw, qs) {
      const r = await fetch('/api/edit/' + cmd + (qs || ''), { method: 'POST', body: raw ? body : JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || ('서버 응답 ' + r.status));
      return j;
    }
    function setMsg(m) { E.msg = m; if (panelKind === 'edit') renderPanel(); T.dirty = true; }
    async function editOpen() {
      if (!isLite()) { setMsg('먼저 도면(DWG·DXF)을 여세요'); return false; }
      if (!localServer()) { setMsg('편집은 이 PC 의 로컬 서버(start-viewer.bat)로 열었을 때만 됩니다'); return false; }
      if (!app.srcBuf) { setMsg('원본 파일을 다시 열어 주세요(원본 사본 없음)'); return false; }
      if (E.busy) return false;
      E.ready = false; E.sel = null; E.ops = []; E.saved = null; E.step = 'idle'; E.busy = '편집 준비 중(큰 도면은 몇 분 걸립니다)';
      const t0 = Date.now(); const tk = setInterval(() => { E.msg = `${E.busy}… ${Math.round((Date.now() - t0) / 1000)}초`; if (panelKind === 'edit') renderPanel(); }, 1000);
      try {
        const j = await api('open', app.srcBuf.slice(0), true, `?type=${app.srcType || 'dwg'}&name=${encodeURIComponent(app.currentFilename || 'drawing')}`);
        E.ready = true; E.info = j; E.step = 'select'; E.op = null;
        setMsg(`편집 준비 끝: 부품(블록 삽입) ${j.inserts.toLocaleString()}개 (${j.seconds}초). 부품을 눌러 고르세요`);
        return true;
      } catch (e) { setMsg('편집 준비 실패: ' + e.message); return false; }
      finally { clearInterval(tk); E.busy = ''; renderPanel(); }
    }
    async function editPick(abs) {
      if (!E.ready) { setMsg('먼저 [편집 준비]'); return null; }
      const tol = 3 / pxPerUnit();
      try {
        const j = await api('pick', { x: abs[0], y: abs[1], tol });
        if (!j.found) { setMsg('그 자리에 부품이 없습니다. 다른 곳을 누르세요'); return null; }
        E.sel = j.found; const b = j.found.bbox;
        setMsg(`선택: ${j.found.name} (도면층 ${j.found.layer}, 크기 ${fmt(b[2] - b[0])}×${fmt(b[3] - b[1])})`); T.dirty = true; return E.sel;
      } catch (e) { setMsg('선택 실패: ' + e.message); return null; }
    }
    function editApply(op, dx, dy) {
      if (!E.sel) { setMsg('먼저 부품을 고르세요'); return false; }
      if (!isFinite(dx) || !isFinite(dy)) { setMsg('거리 값이 올바르지 않습니다'); return false; }
      E.ops.push({ op, handle: E.sel.handle, name: E.sel.name, dx, dy, polys: E.sel.polys, bbox: E.sel.bbox });
      E.saved = null; setMsg(`${op === 'move' ? '이동' : '복사'} ΔX ${fmt(dx)}, ΔY ${fmt(dy)} (${E.ops.length}건, 저장 전까지 파일은 안 바뀝니다)`); T.dirty = true; return true;
    }
    function editUndo() { const o = E.ops.pop(); setMsg(o ? `되돌림: ${o.op === 'move' ? '이동' : '복사'} ${o.name}` : '되돌릴 것이 없습니다'); T.dirty = true; return !!o; }
    async function editSave(fmt) {
      fmt = fmt === 'dwg' || fmt === 'dxf' ? fmt : ((app.srcType === 'dxf') ? 'dxf' : 'dwg');      // 지정이 없으면 원본과 같은 형식으로
      if (!E.ops.length) { setMsg('저장할 변경이 없습니다'); return null; }
      if (E.busy) return null;
      E.busy = '저장 중(큰 도면은 1분 정도)'; renderPanel();
      try {
        const j = await api('save', { ops: E.ops.map((o) => ({ op: o.op, handle: o.handle, dx: o.dx, dy: o.dy })), format: fmt, stem: (app.currentFilename || 'drawing').replace(/\.[^.]+$/, '') });
        E.saved = j; setMsg(`저장함: ${j.path} (이동 ${j.moves}·복사 ${j.copies})`); return j;
      } catch (e) { setMsg('저장 실패: ' + e.message); return null; }
      finally { E.busy = ''; renderPanel(); }
    }
    function startOp(op) {
      if (!isLite()) { toast('도면을 먼저 여세요'); return; }
      if (T.tool !== 'edit') setTool('edit');
      E.op = op;
      if (!E.ready) { setMsg('편집 준비 중입니다… 끝나면 다시 ' + (op === 'move' ? 'M' : 'CO') + ' 를 입력하세요'); if (!E.busy) editOpen(); return; }
      if (!E.sel) { E.step = 'select'; setMsg(`${op === 'move' ? '이동' : '복사'}할 부품을 누르세요`); }
      else { E.step = 'base'; setMsg('기준점을 누르세요(끝점에 자동으로 붙습니다)'); }
      T.dirty = true;
    }
    async function editClick(p) {
      const a = absOf(p);
      if (E.step === 'select' || !E.sel) {
        const s = await editPick(a);
        if (s && E.op) { E.step = 'base'; setMsg(`선택: ${s.name} — 기준점을 누르세요`); }
        return;
      }
      if (E.step === 'base') { E.base = p; E.step = 'target'; setMsg('목표점을 누르세요 (복사는 계속 누르면 여러 개, Enter/Esc 로 끝)'); return; }
      if (E.step === 'target' && E.base) {
        const dx = p[0] - E.base[0], dy = p[1] - E.base[1];
        if (editApply(E.op, dx, dy)) {
          if (E.op === 'move') { E.step = 'select'; E.sel = null; E.op = null; E.base = null; E.hover = null; }
        }
      }
    }
    function editEnd() { E.step = E.ready ? 'select' : 'idle'; E.op = null; E.base = null; E.hover = null; E.sel = null; T.dirty = true; renderPanel(); }

    // ── 마우스: 휠은 커서 위치 기준으로 확대·축소, 아래 상태줄에 커서의 도면 좌표를 실시간 표시 ──
    app.controls.zoomToCursor = true;
    const coordEl = document.createElement('span'); coordEl.id = 'status-coord'; coordEl.style.cssText = 'font-variant-numeric:tabular-nums;color:var(--accent-color);min-width:200px';
    coordEl.textContent = 'X: - Y: -';
    const fi = document.querySelector('.footer-info'); if (fi) fi.insertBefore(coordEl, fi.firstChild);
    // 확대 정도 표시: 화면 100px 가 도면에서 몇 mm 인지(확대하면 숫자가 작아짐) + 전체 보기 대비 배율
    const scaleEl = document.createElement('span'); scaleEl.id = 'status-scale'; scaleEl.style.cssText = 'font-variant-numeric:tabular-nums;color:var(--text-muted);margin-left:12px';
    if (fi) fi.insertBefore(scaleEl, coordEl.nextSibling);
    let fitDist0 = 0;
    function showScale() {
      if (!app.lite) { scaleEl.textContent = ''; return; }
      const d = app.camera.position.distanceTo(app.controls.target);
      if (!fitDist0 || d > fitDist0) fitDist0 = d;                         // 가장 멀리서 본 거리를 전체 보기로 간주
      const mm = 100 / pxPerUnit();
      scaleEl.textContent = `축척 100px ≈ ${mm >= 100 ? Math.round(mm).toLocaleString() : mm.toFixed(1)}mm · ${(fitDist0 / d).toFixed(fitDist0 / d < 10 ? 1 : 0)}배`;
    }
    let coordRaf = 0, lastPt = null;
    function showCoord() {
      coordRaf = 0; if (!lastPt || !app.lite) { coordEl.textContent = 'X: - Y: -'; return; }
      const [wx, wy] = s2w(lastPt[0], lastPt[1]); const o = origin();
      coordEl.textContent = `X: ${(wx + o[0]).toFixed(2)}  Y: ${(wy + o[1]).toFixed(2)}`;
    }
    app.renderer.domElement.addEventListener('pointermove', (e) => {
      const r = e.currentTarget.getBoundingClientRect(); lastPt = [e.clientX - r.left, e.clientY - r.top];
      if (!coordRaf) coordRaf = requestAnimationFrame(showCoord);
    });
    app.renderer.domElement.addEventListener('pointerleave', () => { lastPt = null; if (!coordRaf) coordRaf = requestAnimationFrame(showCoord); });
    app.renderer.domElement.addEventListener('wheel', () => { if (lastPt && !coordRaf) coordRaf = requestAnimationFrame(() => setTimeout(showCoord, 0)); }, { passive: true });

    // ── 입력 연결 ──
    const canvas = app.renderer.domElement;
    // ── 터치(폰) 측정: 손가락으로 끌어도 화면이 같이 움직이지 않게, 한 손가락은 '십자선'만 옮기고(손가락 위쪽 70px) 끝점·중점·교차에 붙는 것을
    //    보여 준 뒤 [점 찍기] 를 눌러 확정한다. 화면 이동·확대는 두 손가락. 마우스는 예전처럼 누르면 바로 찍힘. ──
    let snapMark = null, lastSnapT = 0;
    const DG = { moves: 0, touchMoves: 0, picks: 0, hits: 0, lastMs: 0, lastType: '-' };
    const TOUCH_TOOLS = ['dist', 'path', 'area', 'coord', 'edit'];
    const TP = { coarse: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), showPanel: false, cross: null, snap: null, fingers: new Set(), down: false, last: 0, aim: false, moved: false, start: null, grab: null };
    const TP_OFFSET = 0;                                                  // 손가락이 짚은 곳이 곧 커서(돋보기로 가려진 부분을 본다)
    const tpBar = document.createElement('div'); tpBar.id = 'tp-bar';
    tpBar.innerHTML = '<button class="sub" id="tpPanelBtn">≡ 설정</button><button class="sub" id="tpUndo">↶ 되돌리기</button><button id="tpDone">■ 측정 완료</button><button id="tpPut">✓ 여기에 찍기</button><button class="sub" id="tpCancel">✕ 취소</button>';
    view.appendChild(tpBar);
    const tpCur = document.createElement('div'); tpCur.id = 'tp-cur'; view.appendChild(tpCur);
    function tpCursor() {
      tpCur.style.display = 'none'; return;                      // 화면에는 커서를 그리지 않는다(사용자 요청: 십자선은 돋보기에만)
      if (!TP.cross || !touchTool()) { tpCur.style.display = 'none'; return; }
      const col = TP.snap ? '#2bff7a' : '#ffffff';
      tpCur.style.left = (canvas.offsetLeft + TP.cross.x) + 'px'; tpCur.style.top = (canvas.offsetTop + TP.cross.y) + 'px'; tpCur.style.display = 'block';
      tpCur.innerHTML = `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" stroke="${col}" stroke-width="1.6" style="filter:drop-shadow(0 0 2px #000)"><path d="M4 30H23M37 30H56M30 4V23M30 37V56"/><circle cx="30" cy="30" r="7"/></svg>`;
    }
    const tpInfo = document.createElement('div'); tpInfo.id = 'tp-info'; view.appendChild(tpInfo);
    // 돋보기: 손가락이 십자선을 가려도 보이게, 십자선 둘레를 3배로 확대해 반대편 위쪽 모서리에 보여 준다.
    const loupe = document.createElement('canvas'); loupe.id = 'tp-loupe'; view.appendChild(loupe);
    const LOUPE = { size: 132, zoom: 3 };
    function tpLoupe() {
      if (!TP.cross || !touchTool()) { loupe.style.display = 'none'; return; }
      const { W } = size(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const left = TP.cross.x > W / 2;                                   // 십자선이 오른쪽이면 돋보기는 왼쪽 위, 왼쪽이면 오른쪽 위
      loupe.style.left = left ? '12px' : 'auto'; loupe.style.right = left ? 'auto' : '12px'; loupe.style.display = 'block';
      const px = Math.round(LOUPE.size * dpr);
      if (loupe.width !== px) { loupe.width = px; loupe.height = px; }
      const g = loupe.getContext('2d'); g.fillStyle = '#101114'; g.fillRect(0, 0, px, px);
      const src = LOUPE.size / LOUPE.zoom, sx = TP.cross.x - src / 2, sy = TP.cross.y - src / 2;
      try {
        app.renderer.render(app.scene, app.camera);                      // 바로 이어서 복사하면 그려 둔 화면이 남아 있다
        const gl = app.renderer.domElement, rr = gl.width / Math.max(1, size().W);
        g.imageSmoothingEnabled = true;
        g.drawImage(gl, sx * rr, sy * rr, src * rr, src * rr, 0, 0, px, px);
        const tx = app.textOverlay; if (tx && tx.width) { const tr = tx.width / Math.max(1, size().W); g.drawImage(tx, sx * tr, sy * tr, src * tr, src * tr, 0, 0, px, px); }
        if (cv.width) { const cr = cv.width / Math.max(1, size().W); g.drawImage(cv, sx * cr, sy * cr, src * cr, src * cr, 0, 0, px, px); }
      } catch (e) { /* 복사 실패(그래픽 환경)는 건너뜀 */ }
      const c = px / 2, col = TP.snap ? '#2bff7a' : '#ffffff';
      g.strokeStyle = col; g.lineWidth = 1;                       // 최대한 얇은 선(기기 픽셀 1)
      g.beginPath(); g.moveTo(c - 30 * dpr, c + 0.5); g.lineTo(c - 4 * dpr, c + 0.5); g.moveTo(c + 4 * dpr, c + 0.5); g.lineTo(c + 30 * dpr, c + 0.5);
      g.moveTo(c + 0.5, c - 30 * dpr); g.lineTo(c + 0.5, c - 4 * dpr); g.moveTo(c + 0.5, c + 4 * dpr); g.lineTo(c + 0.5, c + 30 * dpr); g.stroke();
      g.lineWidth = 2 * dpr;
      if (TP.snap) { g.strokeRect(c - 8 * dpr, c - 8 * dpr, 16 * dpr, 16 * dpr); }
    }
    const touchTool = () => TOUCH_TOOLS.includes(T.tool) && isLite();
    function updateTouchMode() {               // 도구가 켜져 있으면 한 손가락 이동을 끈다(두 손가락 이동·확대는 그대로)
      const active = ['dist', 'path', 'area', 'coord', 'edit', 'sel'].includes(T.tool) && isLite();
      app.controls.touches.ONE = active ? -1 : (app.is2DMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE);
    }
    function tpInfoText() {
      const last = T.records[T.records.length - 1];
      if (T.tool === 'dist') {
        if (T.pts.length === 1) return '둘째 점: 십자선을 끝점·중점에 맞추고 손을 떼세요';
        if (last && last.type === '거리') return `거리 ${fmt(last.value)} (ΔX ${fmt(last.dx)}, ΔY ${fmt(last.dy)}, ${last.angle.toFixed(1)}°) · 점 위에 십자선을 올려 끌면 옮길 수 있음`;
        return '처음 점: 손가락을 끌어 십자선을 끝점·중점에 맞추고 손을 떼세요';
      }
      if (T.tool === 'path') {
        if (T.pts.length) return `${T.pts.length}점 · 합계 ${fmt(polyLen(T.pts, false))} · 다음 점을 맞추고 손을 떼세요 · 끝나면 [측정 완료]`;
        if (last && last.type === '길이') return `합계 ${fmt(last.value)} (${last.pts.length - 1}구간) · 새로 재려면 시작점을 찍으세요`;
        return '시작점: 손가락을 끌어 끝점·중점에 맞추고 손을 떼세요';
      }
      if (T.tool === 'area') return T.pts.length ? `${T.pts.length}점 · 점마다 스냅에 맞춰 손을 떼세요 · 끝나면 [측정 완료]` : (last && last.type === '면적' ? `면적 ${fmt(last.value)} · 둘레 ${fmt(last.perimeter)}` : '첫 점: 십자선을 맞추고 손을 떼세요');
      if (T.tool === 'coord') return last && last.type === '좌표' ? `좌표 X ${fmt(last.x)}, Y ${fmt(last.y)}` : '좌표를 볼 곳에 십자선을 맞추고 손을 떼세요';
      if (T.tool === 'edit') return E.msg || '';
      return '';
    }
    function tpShow() {
      if (!T.ready) return;                                     // 시작(boot)이 끝나기 전에는 패널 등이 아직 없다
      const aiming = !!(TP.cross && touchTool());
      const hasWork = touchTool() && (T.pts.length > 0 || T.records.length > 0);
      const idle = touchTool() && !TP.down;
      $('tpPut').style.display = aiming ? '' : 'none'; $('tpCancel').style.display = aiming ? '' : 'none';
      $('tpUndo').style.display = (idle && hasWork) ? '' : 'none';
      const doneOk = (T.tool === 'path' && T.pts.length >= 2) || (T.tool === 'area' && T.pts.length >= 3);
      $('tpDone').style.display = (idle && doneOk) ? '' : 'none';
      $('tpPanelBtn').style.display = (idle && TP.coarse && !aiming) ? '' : 'none';
      tpBar.style.display = (aiming || (idle && (hasWork || TP.coarse || doneOk))) ? 'flex' : 'none';
      // 터치로 쓰는 중이면 큰 측정 패널은 숨긴다(손가락 조준·화면을 가리고, 패널 위에서는 점을 못 찍으므로). [≡ 설정] 으로 잠깐 열 수 있다.
      const hidePanel = touchTool() && TP.coarse && !TP.showPanel;
      panel.style.display = hidePanel ? 'none' : '';
      panel.style.visibility = aiming ? 'hidden' : '';
      let txt = (touchTool() && TP.coarse && !TP.showPanel) ? tpInfoText() : '';
      if (txt && TP.cross && TP.down) txt = (TP.snap ? `스냅: ${SNAP_NAME[TP.snap.type] || TP.snap.type}` : (SNAP.on ? '스냅 없음(근처에 끝점·중점·교차 없음)' : '스냅 꺼짐')) + ' · ' + txt;
      tpInfo.textContent = txt; tpInfo.style.display = txt ? 'block' : 'none';
    }
    function tpClear() { T.hover = null; TP.cross = null; if (typeof tpCursor === 'function') tpCursor(); TP.snap = null; snapMark = null; tpShow(); loupe.style.display = 'none'; T.dirty = true; }
    /* 이미 찍은 점(진행 중인 점 + 기록된 측정의 점)을 옮길 수 있게: 십자선이 점 위에 올라가 있으면 그 점을 '잡는다'. */
    function tpHandles() {
      const h = [];
      T.pts.forEach((p, i) => h.push({ p, rec: null, i }));
      T.records.forEach((r) => (r.pts || []).forEach((p, i) => h.push({ p, rec: r, i })));
      return h;
    }
    function tpFindHandle(cx, cy) {
      let best = null, bd = 24;
      for (const hd of tpHandles()) { const [sx, sy] = w2s(hd.p[0], hd.p[1]); const d = Math.hypot(sx - cx, sy - cy); if (d < bd) { bd = d; best = hd; } }
      return best;
    }
    function tpRecompute(r) {
      if (!r) return;
      if (r.type === '거리') { const [p, q] = r.pts; r.dx = q[0] - p[0]; r.dy = q[1] - p[1]; r.value = Math.hypot(r.dx, r.dy); r.angle = Math.atan2(r.dy, r.dx) * 180 / Math.PI; }
      else if (r.type === '면적') { r.value = polyArea(r.pts); r.perimeter = polyLen(r.pts, true); }
      else if (r.type === '길이') { r.value = polyLen(r.pts, false); }
      else if (r.type === '좌표') { const o = origin(); r.x = r.pts[0][0] + o[0]; r.y = r.pts[0][1] + o[1]; }
    }
    function tpUndo() {
      if (T.pts.length) T.pts.pop(); else if (T.records.length) T.records.pop();
      T.hover = null; T.dirty = true; renderPanel(); tpShow();
    }
    function tpMove(e) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = Math.max(0, e.clientY - r.top - TP_OFFSET);
      TP.cross = { x, y };
      const t0 = performance.now(); const q = pickPoint(x, y, false, 24); DG.touchMoves++; DG.picks++; DG.lastMs = Math.round(performance.now() - t0); if (q.snapped) { DG.hits++; DG.lastType = q.type; }
      TP.snap = q.snapped ? { p: q.p, type: q.type } : null; TP.pt = q.p; snapMark = TP.snap;
      if (T.tool === 'edit' && E.step === 'target') E.hover = q.p; else if (['dist', 'path', 'area'].includes(T.tool) && T.pts.length) T.hover = q.p;
      if (TP.grab) { TP.grab.p[0] = q.p[0]; TP.grab.p[1] = q.p[1]; tpRecompute(TP.grab.rec); }
      T.dirty = true; tpShow(); tpLoupe(); tpCursor();
    }
    function tpPut() {
      if (!TP.cross || !touchTool()) return;
      const { x, y } = TP.cross, pt = TP.pt; tpClear(); onClick(x, y, false, pt); tpShow();
    }
    canvas.addEventListener('pointerdown', (e) => {                      // 캡처 단계: OrbitControls 가 받기 전에 한 손가락 이동을 끈다
      updateTouchMode();
      const wasCoarse = TP.coarse; TP.coarse = e.pointerType === 'touch' || e.pointerType === 'pen'; if (wasCoarse !== TP.coarse) tpShow();
      if (e.pointerType !== 'touch' || !touchTool()) return;
      TP.fingers.add(e.pointerId);
      if (TP.fingers.size === 1) {
        TP.down = true; TP.aim = true; TP.moved = false; TP.start = { x: e.clientX, y: e.clientY }; TP.grab = null;
        tpMove(e);
        if (TP.cross) { TP.grab = tpFindHandle(TP.cross.x, TP.cross.y); if (TP.grab) { TP.snap = null; snapMark = null; } }    // 십자선이 찍어 둔 점 위면 그 점을 잡음
      } else { TP.down = false; TP.aim = false; TP.grab = null; }                                   // 두 손가락이면 이동·확대
    }, true);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !touchTool() || !TP.down || TP.fingers.size !== 1) return;
      if (TP.start && Math.hypot(e.clientX - TP.start.x, e.clientY - TP.start.y) > 6) TP.moved = true;
      const nw = performance.now(); if (nw - TP.last < (isBig() ? 100 : 40)) return; TP.last = nw; tpMove(e);
    });
    const tpEnd = (e) => {
      if (e.pointerType !== 'touch') return;
      TP.fingers.delete(e.pointerId);
      if (TP.fingers.size !== 0) return;
      const wasAim = TP.aim, moved = TP.moved, grab = TP.grab, snapped = !!TP.snap;
      TP.down = false; TP.aim = false; TP.grab = null; TP.start = null;
      if (!(TP.cross && touchTool())) { tpShow(); return; }
      if (wasAim && grab) {                                   // 찍어 둔 점을 옮기던 중 손을 뗌 → 그 자리(스냅이면 스냅 점)로 확정
        tpClear(); tpRecompute(grab.rec); renderPanel(); if (navigator.vibrate) navigator.vibrate(12); return;
      }
      if (wasAim && moved && snapped) {                       // 끌어서 스냅이 잡힌 채 손을 뗌 → 바로 점으로 확정
        if (navigator.vibrate) navigator.vibrate(12);
        tpPut(); return;
      }
      tpShow();                                               // 그냥 눌렀거나 스냅이 없으면 십자선을 남기고 [여기에 찍기] 로 확정/다시 끌어서 조정
    };
    canvas.addEventListener('pointerup', tpEnd); canvas.addEventListener('pointercancel', tpEnd);
    $('tpPut').addEventListener('click', tpPut); $('tpCancel').addEventListener('click', tpClear); $('tpUndo').addEventListener('click', tpUndo);
    $('tpDone').addEventListener('click', () => { if (T.tool === 'path') finishPath(); else if (T.tool === 'area') finishArea(); renderPanel(); tpShow(); });
    $('tpPanelBtn').addEventListener('click', () => { TP.showPanel = !TP.showPanel; if (TP.showPanel) panel.classList.add('open'); tpShow(); renderPanel(); });
    let down = null, lastHover = 0, zw = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.button }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const btn = down.t; down = null;
      if (e.pointerType === 'touch' && TOUCH_TOOLS.includes(T.tool)) return;                    // 터치 측정은 십자선 + [점 찍기]
      if (moved < 6 && btn === 0 && ['dist', 'path', 'area', 'coord', 'edit', 'sel'].includes(T.tool)) { const r = canvas.getBoundingClientRect(); onClick(e.clientX - r.left, e.clientY - r.top, e.shiftKey); }
    });
    canvas.addEventListener('pointermove', (e) => {         // 스냅 표식(측정·면적·좌표·편집 도구가 켜져 있을 때)
      if (e.pointerType === 'touch') return;
      if (!['dist', 'path', 'area', 'coord', 'edit'].includes(T.tool) || !isLite()) { if (snapMark) { snapMark = null; T.dirty = true; } return; }
      const nw = performance.now(); if (nw - lastSnapT < (isBig() ? 120 : 70)) return; lastSnapT = nw;
      const rr = canvas.getBoundingClientRect(); DG.moves++; const t0 = performance.now(); const r = pickPoint(e.clientX - rr.left, e.clientY - rr.top, false);
      DG.picks++; DG.lastMs = Math.round(performance.now() - t0); if (r.snapped) { DG.hits++; DG.lastType = r.type; }
      snapMark = r.snapped ? { p: r.p, type: r.type } : null; T.dirty = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (T.tool === 'edit' && E.step === 'target' && isLite()) { const nw = performance.now(); if (nw - lastHover < 50) return; lastHover = nw; const rr = canvas.getBoundingClientRect(); E.hover = pickPoint(e.clientX - rr.left, e.clientY - rr.top, false).p; T.dirty = true; return; }
      if (!['dist', 'path', 'area'].includes(T.tool) || !T.pts.length || !isLite()) return;
      const now = performance.now(); if (now - lastHover < (isBig() ? 120 : 70)) return; lastHover = now;
      const r = canvas.getBoundingClientRect(); T.hover = pickPoint(e.clientX - r.left, e.clientY - r.top, false).p; T.dirty = true;
    });
    canvas.addEventListener('dblclick', () => { if (T.tool === 'area' && T.pts.length > 3) { T.pts.pop(); finishArea(); renderPanel(); } else if (T.tool === 'path' && T.pts.length > 2) { T.pts.pop(); finishPath(); renderPanel(); } });
    view.addEventListener('pointerdown', (e) => {                       // 영역 확대: 끌어서 상자 지정 (돌려보기·이동보다 먼저 받음)
      if (T.tool !== 'zoomwin' || e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const r = canvas.getBoundingClientRect(); zw = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top };
    }, true);
    window.addEventListener('pointermove', (e) => { if (!zw) return; const r = canvas.getBoundingClientRect(); zw.x1 = e.clientX - r.left; zw.y1 = e.clientY - r.top; T.dirty = true; });
    window.addEventListener('pointerup', () => {
      if (!zw) return; const z = zw; zw = null;
      if (Math.abs(z.x1 - z.x0) > 6 && Math.abs(z.y1 - z.y0) > 6) { const a = s2w(z.x0, z.y0), b = s2w(z.x1, z.y1); zoomWindow(a[0], a[1], b[0], b[1]); }
      setTool(null); T.dirty = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.key === 'Escape') { if (T.tool === 'sel' && S.sel.length) { S.sel = []; T.dirty = true; renderPanel(); } else if (T.tool === 'edit' && (E.op || E.sel)) { editEnd(); } else { T.pts = []; T.hover = null; setTool(null); T.dirty = true; } }
      else if (e.key === 'Enter' && T.tool === 'edit' && (E.op || E.sel)) { editEnd(); }
      else if (e.key === 'Enter' && T.tool === 'area') { finishArea(); renderPanel(); }
      else if (e.key === 'Enter' && T.tool === 'path') { finishPath(); renderPanel(); }
      else if (e.key === 'Backspace' && T.pts.length) { T.pts.pop(); T.dirty = true; renderPanel(); }
    });

    // ── 그리기(겹침 캔버스) ──
    const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (+n.toFixed(3)).toString());
    function label(ctx, x, y, s) {
      ctx.font = '12px "Malgun Gothic", sans-serif'; const w = ctx.measureText(s).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(x - w / 2, y - 22, w, 18); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(s, x, y - 9); ctx.textAlign = 'left';
    }
    function draw() {
      const { W, H } = size(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      app.camera.updateMatrixWorld();
      const sig = app.camera.matrixWorld.elements.join(',') + '|' + app.camera.projectionMatrix.elements[0] + '|' + W + 'x' + H;
      if (!T.dirty && sig === T.sig) return;
      T.sig = sig; T.dirty = false;
      showScale();
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (!app.lite) return;
      // 찾은 글자 표시
      const f = T.find;
      if (f.res.length) {
        let n = 0;
        f.res.forEach((ti, k) => {
          if (n > 800) return; const t = app.lite.texts[ti]; const [x, y] = w2s(t.x, t.y);
          if (x < -50 || y < -50 || x > W + 50 || y > H + 50) return; n++;
          const r = Math.max(10, t.h * pxPerUnit() * 0.9); ctx.lineWidth = k === f.cur ? 3 : 1.5; ctx.strokeStyle = k === f.cur ? '#ff3df2' : '#ffd400';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        });
      }
      // 측정
      const colors = { 거리: '#00e5ff', 길이: '#ff6bd6', 면적: '#7CFC00', 좌표: '#ffb300' };
      const drawPts = (pts, color, closed, fill) => {
        if (!pts.length) return; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); if (closed) ctx.closePath();
        if (fill) { ctx.save(); ctx.globalAlpha = 0.18; ctx.fill(); ctx.restore(); } ctx.stroke();
        const hr = touchTool() ? 7 : 4;
        pts.forEach((p) => { const [x, y] = w2s(p[0], p[1]); ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill(); });
      };
      // 연속 길이: 각 점 번호 + 구간마다 길이 + 마지막 점 옆에 합계
      const pathLabels = (pts, color, total, extra) => {
        ctx.save(); ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); ctx.fillText(String(i + 1), x + 9, y - 6); });
        ctx.restore();
        for (let i = 1; i < pts.length; i++) { const [x, y] = w2s((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2); label(ctx, x, y, fmt(dist2(pts[i - 1], pts[i]))); }
        if (pts.length > 1) { const [x, y] = w2s(pts[pts.length - 1][0], pts[pts.length - 1][1]); label(ctx, x, y + 22, '합계 ' + fmt(total) + (extra || '')); }
      };
      T.records.forEach((r) => {
        if (r.type === '길이') { drawPts(r.pts, colors[r.type], false, false); pathLabels(r.pts, colors[r.type], r.value); return; }
        const c = colors[r.type]; drawPts(r.pts, c, r.type === '면적', r.type === '면적');
        const m = r.pts.reduce((a, p) => [a[0] + p[0] / r.pts.length, a[1] + p[1] / r.pts.length], [0, 0]); const [x, y] = w2s(m[0], m[1]);
        label(ctx, x, y, r.type === '거리' ? fmt(r.value) : r.type === '면적' ? fmt(r.value) : `${fmt(r.x)}, ${fmt(r.y)}`);
      });
      if (T.pts.length) {
        const lastP = T.pts[T.pts.length - 1], pts = (T.hover && dist2(T.hover, lastP) > 1e-9) ? T.pts.concat([T.hover]) : T.pts; drawPts(pts, '#ffffff', false, false);
        if (T.tool === 'path') pathLabels(pts, '#ffffff', polyLen(pts, false));
        if (T.hover && T.tool === 'dist') { const a = T.pts[T.pts.length - 1]; const [x, y] = w2s((a[0] + T.hover[0]) / 2, (a[1] + T.hover[1]) / 2); label(ctx, x, y, fmt(dist2(a, T.hover))); }
        if (T.hover && T.tool === 'area' && T.pts.length >= 2) { const [x, y] = w2s(T.hover[0], T.hover[1]); label(ctx, x, y - 6, fmt(polyArea(pts))); }
      }

      // 편집: 선택한 부품(노랑), 이동 전 자리(빨간 점선 상자)·이동/복사 결과(주황/초록), 이동 미리보기(흰색)
      if (T.tool === 'edit' || E.ops.length || E.sel) {
        const o = origin();
        const strokePolys = (polys, dx, dy, color, width, dash) => {
          ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); let n = 0;
          for (const pl of polys) { for (let i = 0; i < pl.length; i++) { const [x, y] = w2s(pl[i][0] - o[0] + dx, pl[i][1] - o[1] + dy); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); n++; } if (n > 20000) break; }
          ctx.stroke(); ctx.setLineDash([]);
        };
        const box = (b, dx, dy, color) => { const [x0, y0] = w2s(b[0] - o[0] + dx, b[3] - o[1] + dy), [x1, y1] = w2s(b[2] - o[0] + dx, b[1] - o[1] + dy); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); };
        E.ops.forEach((op) => {
          if (op.op === 'move') box(op.bbox, 0, 0, '#ff4d4d');
          strokePolys(op.polys, op.dx, op.dy, op.op === 'move' ? '#ff9f1a' : '#3ddc84', 2);
        });
        if (E.sel) { strokePolys(E.sel.polys, 0, 0, '#ffe14d', 2); box(E.sel.bbox, 0, 0, '#ffe14d'); }
        if (E.sel && E.step === 'target' && E.base && E.hover) {
          const dx = E.hover[0] - E.base[0], dy = E.hover[1] - E.base[1];
          strokePolys(E.sel.polys, dx, dy, '#ffffff', 1.5, [4, 3]);
          const [bx, by] = w2s(E.base[0], E.base[1]), [hx, hy] = w2s(E.hover[0], E.hover[1]);
          ctx.strokeStyle = '#ffffff'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
          label(ctx, hx, hy, `ΔX ${fmt(dx)}  ΔY ${fmt(dy)}`);
        }
      }
      if (S.sel.length && S.src === app.lite) {                                              // 선택한 부품: 노란 테두리 + 이름
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffd400'; ctx.fillStyle = 'rgba(255,212,0,.12)';
        for (const o of S.sel.slice(0, 200)) {
          const [ax, ay] = w2s(o.x0, o.y1), [bx, by] = w2s(o.x1, o.y0);
          const w = Math.max(bx - ax, 6), h = Math.max(by - ay, 6);
          if (ax > W + 50 || ay > H + 50 || ax + w < -50 || ay + h < -50) continue;
          ctx.fillRect(ax, ay, w, h); ctx.strokeRect(ax, ay, w, h);
          if (S.sel.length < 20) label(ctx, ax + w / 2, ay - 4, o.n);
        }
      }
      if (snapMark && ['dist', 'path', 'area', 'coord', 'edit'].includes(T.tool)) {                  // 스냅 표식: 끝점 □ · 중점 △ · 교차 ×
        const [sx, sy] = w2s(snapMark.p[0], snapMark.p[1]); const col = { end: '#2bff7a', mid: '#2bd8ff', int: '#ff4df0' }[snapMark.type];
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
        if (snapMark.type === 'end') ctx.rect(sx - 6, sy - 6, 12, 12);
        else if (snapMark.type === 'mid') { ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 7, sy + 6); ctx.lineTo(sx - 7, sy + 6); ctx.closePath(); }
        else { ctx.moveTo(sx - 6, sy - 6); ctx.lineTo(sx + 6, sy + 6); ctx.moveTo(sx + 6, sy - 6); ctx.lineTo(sx - 6, sy + 6); }
        ctx.stroke(); label(ctx, sx + 18, sy - 2, SNAP_NAME[snapMark.type]);
      }
      if (zw) { ctx.strokeStyle = '#4da3ff'; ctx.fillStyle = 'rgba(77,163,255,.15)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); const x = Math.min(zw.x0, zw.x1), y = Math.min(zw.y0, zw.y1), w = Math.abs(zw.x1 - zw.x0), h = Math.abs(zw.y1 - zw.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); }
    }
    (function loop() { try { draw(); } catch (e) { /* 그리기 오류가 화면 전체를 멈추지 않게 */ } requestAnimationFrame(loop); })();

    // ── 도면층 관리 보강: 찾기 칸, 단독 보기, 투명도(0~90%) ──
    const layerPanel = $('layer-panel');
    const filter = document.createElement('input'); filter.type = 'text'; filter.placeholder = '도면층 이름 찾기'; filter.id = 'layerFilter';
    filter.style.cssText = 'height:26px;border-radius:6px;border:1px solid var(--panel-border);background:var(--btn-bg);color:var(--text-main);padding:0 8px;font-size:12px;user-select:text';
    layerPanel.insertBefore(filter, $('layerList'));
    filter.addEventListener('input', () => app.updateLayerPanel());
    let isolated = null;
    app.updateLayerPanel = function () {
      const list = $('layerList'); list.innerHTML = '';
      if (this.layers.size === 0) { list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px;">레이어가 없습니다.</div>'; return; }
      const q = filter.value.trim().toLowerCase();
      this.layers.forEach((layer) => {
        if (q && !layer.name.toLowerCase().includes(q)) return;
        const item = document.createElement('div'); item.className = 'layer-item';
        const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = layer.visible;
        chk.addEventListener('change', (e) => { this.toggleLayer(layer.name, e.target.checked); T.dirty = true; });
        const dot = document.createElement('div'); dot.className = 'layer-dot'; dot.style.background = '#' + layer.color.toString(16).padStart(6, '0');
        const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = layer.name; name.title = layer.name;
        const ex = document.createElement('div'); ex.className = 'layer-extra';
        const iso = document.createElement('button'); iso.textContent = isolated === layer.name ? '전체' : '단독'; iso.title = '이 도면층만 보기 / 전체 보기';
        iso.addEventListener('click', () => isolateLayer(isolated === layer.name ? null : layer.name));
        const rg = document.createElement('input'); rg.type = 'range'; rg.min = 0; rg.max = 90; rg.step = 10; rg.value = Math.round((1 - (layer.opacity === undefined ? 1 : layer.opacity)) * 100); rg.title = '투명도 ' + rg.value + '%';
        rg.addEventListener('input', () => { setLayerTransparency(layer.name, +rg.value); rg.title = '투명도 ' + rg.value + '%'; });
        ex.append(iso, rg); item.append(chk, dot, name, ex); list.appendChild(item);
      });
    };
    function setLayerTransparency(nameOrLayer, pct) {
      const layer = typeof nameOrLayer === 'string' ? app.layers.get(nameOrLayer) : nameOrLayer; if (!layer) return false;
      const op = 1 - Math.min(90, Math.max(0, pct)) / 100; layer.opacity = op;
      layer.group.traverse((c) => { if (c.material && 'opacity' in c.material) { c.material.transparent = op < 1; c.material.opacity = op; c.material.needsUpdate = true; } });
      app.textsDirty = true; return true;
    }
    function isolateLayer(name) {
      isolated = name;
      app.layers.forEach((l) => { const on = !name || l.name === name; l.visible = on; l.group.visible = on; });
      app.textsDirty = true; T.dirty = true; app.updateLayerPanel(); return true;
    }

    // ── 내보내기(PNG) ──
    function exportPng(download) {
      app.renderer.render(app.scene, app.camera);
      const src = app.renderer.domElement; const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const x = c.getContext('2d'); x.drawImage(src, 0, 0);
      if (app.textOverlay && app.textOverlay.width) x.drawImage(app.textOverlay, 0, 0, c.width, c.height);
      if (cv.width) x.drawImage(cv, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/png');
      if (download) { const a = document.createElement('a'); a.href = url; a.download = (app.currentFilename || 'cad').replace(/\.[^.]+$/, '') + '.png'; document.body.appendChild(a); a.click(); a.remove(); }
      return url;
    }

    // ── 패널 UI ──
    const bar = document.createElement('div'); bar.className = 'floating-tools';
    const defs = [['find', '찾기', '글자 찾기'], ['dist', '거리', '두 점 거리 (끝점 자동 맞춤)'], ['path', '연속', '여러 점을 차례로 찍어 구간별 길이와 합계 (Enter/더블클릭/완료 단추로 끝)'], ['area', '면적', '여러 점으로 면적·둘레 (Enter/더블클릭 완료)'], ['coord', '좌표', '점 좌표 보기'],
      ['sel', '선택', '부품(블록) 선택 — 누르면 고르고 정보 표시, 같은 자리를 다시 누르면 겹친 다음 부품, Shift 로 여러 개'], ['edit', '편집', '부품 이동(M)·복사(CO) — 원본은 그대로, 새 DXF 로 저장'], ['zoomwin', '영역', '끌어서 영역 확대'], ['prev', '이전', '이전 보기'], ['font', '글꼴', '글자 표시·글꼴 설정'], ['png', 'PNG', '지금 화면을 PNG로 저장']];
    const btns = {};
    defs.forEach(([k, txt, tip]) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = txt; b.title = tip; b.dataset.k = k; bar.appendChild(b); btns[k] = b; });
    view.appendChild(bar);
    const panel = document.createElement('div'); panel.id = 'cad-panel'; view.appendChild(panel);
    let panelKind = null;

    function setTool(t) {
      if (t && !isLite() && t !== 'prev' && t !== 'png') { toast('큰 도면(DWG·DXF) 모드에서 쓸 수 있습니다'); return; }
      T.tool = (T.tool === t) ? null : t; T.pts = []; T.hover = null; T.dirty = true; TP.showPanel = false; tpClear(); updateTouchMode();
      Object.keys(btns).forEach((k) => btns[k].classList.toggle('active', k === T.tool || (k === panelKind && panel.classList.contains('open'))));
      canvas.style.cursor = T.tool ? 'crosshair' : '';
      if (['dist', 'path', 'area', 'coord'].includes(T.tool)) { panelKind = 'measure'; panel.classList.add('open'); }
      else if (T.tool === 'sel') { panelKind = 'sel'; panel.classList.add('open'); }
      else if (T.tool === 'edit') { panelKind = 'edit'; panel.classList.add('open'); if (!E.ready && !E.busy && localServer() && isLite()) setTimeout(editOpen, 0); }
      else if (T.tool === null && (panelKind === 'measure' || panelKind === 'edit' || panelKind === 'sel')) panel.classList.remove('open');
      renderPanel();
    }
    function openPanel(kind) {
      if (panelKind === kind && panel.classList.contains('open')) { panel.classList.remove('open'); panelKind = null; renderPanel(); return; }
      if (T.tool) { T.tool = null; T.pts = []; T.hover = null; canvas.style.cursor = ''; }
      panelKind = kind; panel.classList.add('open'); renderPanel(); T.dirty = true;
      if (kind === 'find') setTimeout(() => { const i = $('findQ'); if (i) i.focus(); }, 30);
    }
    function syncBtns() { Object.keys(btns).forEach((k) => btns[k].classList.toggle('active', k === T.tool || (panel.classList.contains('open') && ((k === 'find' && panelKind === 'find') || (k === 'font' && panelKind === 'font'))))); }
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
      if (k === 'find') openPanel('find'); else if (k === 'font') openPanel('font');
      else if (k === 'prev') prevView(); else if (k === 'png') exportPng(true);
      else setTool(k);
      syncBtns();
    });

    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function renderPanel() {
      syncBtns(); if (typeof tpShow === 'function') tpShow();
      if (!panel.classList.contains('open')) return;
      if (panelKind === 'find') {
        const f = T.find, o = f.opts;
        const keepFocus = document.activeElement && document.activeElement.id === 'findQ';
        panel.innerHTML = `<h4>글자 찾기 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <div class="row"><input type="text" id="findQ" placeholder="찾을 내용" value="${esc(f.q)}"><button class="btn" id="fPrev">◀</button><button class="btn" id="fNext">▶</button></div>
          <label><input type="checkbox" id="oCs" ${o.cs ? 'checked' : ''}>대소문자 구분</label>
          <label><input type="checkbox" id="oWord" ${o.word ? 'checked' : ''}>단어 단위로</label>
          <label><input type="checkbox" id="oWild" ${o.wild ? 'checked' : ''}>와일드카드 사용 (* ?)</label>
          <label><input type="checkbox" id="oHid" ${o.skipHidden ? 'checked' : ''}>꺼진 도면층 무시</label>
          <div class="muted">${f.q ? `${f.res.length.toLocaleString()}개 찾음${f.cur >= 0 ? ` · ${f.cur + 1}번째` : ''}` : '내용을 입력하세요'}</div>
          <div class="list" id="fList">${f.res.slice(0, 300).map((ti, k) => { const t = app.lite.texts[ti]; return `<div class="item ${k === f.cur ? 'cur' : ''}" data-k="${k}"><span>${esc((t._l || []).join(' ').slice(0, 60))}</span><small>${esc(t.layer)}</small></div>`; }).join('')}</div>`;
        const q = $('findQ'); if (keepFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
        let tm; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => find(q.value), 250); });
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (T.find.q !== q.value) find(q.value); findGo(e.shiftKey ? -1 : 1); } });
        [['oCs', 'cs'], ['oWord', 'word'], ['oWild', 'wild'], ['oHid', 'skipHidden']].forEach(([id, key]) => $(id).addEventListener('change', (e) => { o[key] = e.target.checked; find(q.value); }));
        $('fPrev').onclick = () => findGo(-1); $('fNext').onclick = () => findGo(1);
        $('fList').onclick = (e) => { const it = e.target.closest('.item'); if (!it) return; f.cur = +it.dataset.k; zoomToText(app.lite.texts[f.res[f.cur]]); renderPanel(); };
      } else if (panelKind === 'measure') {
        const hint = { dist: '두 점을 차례로 누르세요 (끝점에 자동으로 붙습니다)', path: '점을 차례로 누르세요(구간 길이·합계가 표시됩니다) · Enter·더블클릭·[측정 완료]로 끝내세요 · Backspace 한 점 취소', area: '점을 차례로 누르고 Enter 또는 더블클릭으로 끝내세요 · Backspace 한 점 취소', coord: '좌표를 볼 점을 누르세요' }[T.tool] || '아래 측정 도구를 고르세요';
        panel.innerHTML = `<h4>측정 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <div class="muted">${hint}${T.tool === 'area' ? ` · 현재 ${T.pts.length}점` : ''}${T.tool === 'path' ? ` · 현재 ${T.pts.length}점 · 합계 ${fmt(polyLen(T.pts, false))}` : ''}</div>
          <div class="row" style="gap:10px;flex-wrap:wrap"><label><input type="checkbox" id="snOn" ${SNAP.on ? 'checked' : ''}>스냅</label><label><input type="checkbox" id="snEnd" ${SNAP.end ? 'checked' : ''}>끝점 □</label><label><input type="checkbox" id="snMid" ${SNAP.mid ? 'checked' : ''}>중점 △</label><label><input type="checkbox" id="snInt" ${SNAP.int ? 'checked' : ''}>교차 ×</label></div>
          <div class="row">${T.tool === 'area' ? '<button class="btn" id="mDone">면적 완료</button>' : ''}${T.tool === 'path' ? '<button class="btn" id="mDone">측정 완료</button>' : ''}<button class="btn" id="mClear">기록 지우기</button><button class="btn" id="mCsv">CSV 저장</button></div>
          <div class="list">${T.records.map((r, i) => `<div class="item"><b>${i + 1}</b><span>${r.type === '길이' ? `길이 합계 ${fmt(r.value)} (${r.pts.length - 1}구간: ${r.pts.slice(1).map((p, k) => fmt(dist2(r.pts[k], p))).join(' + ')})` : r.type === '거리' ? `거리 ${fmt(r.value)} (ΔX ${fmt(r.dx)}, ΔY ${fmt(r.dy)}, ${r.angle.toFixed(1)}°)` : r.type === '면적' ? `면적 ${fmt(r.value)} · 둘레 ${fmt(r.perimeter)}` : `X ${fmt(r.x)}, Y ${fmt(r.y)}`}</span></div>`).join('') || '<span class="muted">기록이 없습니다</span>'}</div>
          <div class="muted">값은 도면 단위(mm 도면이면 mm, 면적은 mm²)입니다.</div>`;
        [['snOn', 'on', 'snapOn'], ['snEnd', 'end', 'snapEnd'], ['snMid', 'mid', 'snapMid'], ['snInt', 'int', 'snapInt']].forEach(([id, k, sk]) => { const el = $(id); if (el) el.onchange = (e) => { SNAP[k] = e.target.checked; store.set(sk, SNAP[k]); }; });
        if ($('mDone')) $('mDone').onclick = () => { if (T.tool === 'path') finishPath(); else finishArea(); renderPanel(); };
        $('mClear').onclick = () => { T.records = []; T.pts = []; T.hover = null; T.dirty = true; renderPanel(); };
        $('mCsv').onclick = () => downloadCsv();
      } else if (panelKind === 'sel') {
        const n = objsList().length;
        const first = S.sel[0];
        panel.innerHTML = `<h4>부품 선택 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <div class="muted">${n ? `부품 ${n.toLocaleString()}개 · 누르면 고르고, 같은 자리를 다시 누르면 겹친 다음 부품, Shift+누름으로 여러 개` : '이 도면에는 부품 정보가 없습니다(도면을 다시 열어 보세요)'}</div>
          <div class="row"><button class="btn" id="sZoom" style="width:auto;padding:0 8px" ${S.sel.length ? '' : 'disabled'}>확대</button>
            <button class="btn" id="sNext" style="width:auto;padding:0 8px" ${S.cand.length > 1 ? '' : 'disabled'}>겹친 것 다음</button>
            <button class="btn" id="sClear" style="width:auto;padding:0 8px" ${S.sel.length ? '' : 'disabled'}>해제</button></div>
          ${first ? (() => { const i = selInfo(first); return `<div class="list" style="max-height:none"><div class="item" style="flex-direction:column"><b>${esc(i.name)}</b><span class="muted">도면층 ${esc(i.layer)} · 핸들 ${esc(i.handle)}</span><span class="muted">위치 X ${fmt(i.x)}, Y ${fmt(i.y)} · 크기 ${fmt(i.width)} × ${fmt(i.height)}</span>${S.cand.length > 1 ? `<span class="muted">이 자리에 겹친 부품 ${S.cand.length}개 중 ${S.ci + 1}번째(작은 것부터)</span>` : ''}</div></div>`; })() : ''}
          ${S.sel.length > 1 ? `<div class="muted">선택 ${S.sel.length}개</div><div class="list">${S.sel.slice(0, 60).map((o, k) => `<div class="item" data-k="${k}"><span>${esc(o.n)}</span><small>${esc(o.l)}</small></div>`).join('')}</div>` : ''}`;
        $('sZoom').onclick = () => selZoom();
        $('sNext').onclick = () => { if (S.cand.length > 1) { S.ci = (S.ci + 1) % S.cand.length; S.sel = [S.cand[S.ci]]; T.dirty = true; renderPanel(); } };
        $('sClear').onclick = () => { S.sel = []; T.dirty = true; renderPanel(); };
      } else if (panelKind === 'edit') {
        const stepTxt = { idle: '준비 전', select: '부품을 누르세요', base: '기준점을 누르세요', target: '목표점을 누르세요' }[E.step] || '';
        panel.innerHTML = `<h4>부품 이동·복사 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <div class="muted" id="eMsg">${esc(E.busy ? E.msg : E.msg)}</div>
          <div class="muted">단계: ${stepTxt}${E.op ? ' · ' + (E.op === 'move' ? '이동(M)' : '복사(CO)') : ''}</div>
          <div class="row"><button class="btn" id="eOpen" style="width:auto;padding:0 8px" ${E.busy ? 'disabled' : ''}>${E.ready ? '다시 준비' : '편집 준비'}</button>
            <button class="btn" id="eMove" style="width:auto;padding:0 8px" ${E.ready ? '' : 'disabled'}>이동 M</button>
            <button class="btn" id="eCopy" style="width:auto;padding:0 8px" ${E.ready ? '' : 'disabled'}>복사 CO</button></div>
          <div class="row"><button class="btn" id="eUndo" style="width:auto;padding:0 8px">되돌리기 U</button>
            <button class="btn" id="eSaveDwg" style="width:auto;padding:0 8px" ${E.ops.length && !E.busy ? '' : 'disabled'}>DWG로 저장 (${E.ops.length}건)</button>
            <button class="btn" id="eSaveDxf" style="width:auto;padding:0 8px" ${E.ops.length && !E.busy ? '' : 'disabled'}>DXF로 저장</button></div>
          <div class="row"><input type="text" id="eDx" placeholder="ΔX" style="width:80px"><input type="text" id="eDy" placeholder="ΔY" style="width:80px">
            <button class="btn" id="eApply" style="width:auto;padding:0 8px" ${E.sel ? '' : 'disabled'}>값으로 ${E.op === 'copy' ? '복사' : '이동'}</button></div>
          <div class="list">${E.ops.map((o, i) => `<div class="item"><b>${i + 1}</b><span>${o.op === 'move' ? '이동' : '복사'} ${esc(o.name)} (ΔX ${fmt(o.dx)}, ΔY ${fmt(o.dy)})</span></div>`).join('') || '<span class="muted">변경 없음</span>'}</div>
          ${E.saved ? `<div class="muted">저장됨: ${esc(E.saved.path)}<br>${window.cadApp ? '<button class="btn" id="eShow" style="width:auto;padding:0 8px;height:24px">폴더에서 보기</button>' : `<a href="/api/edit/download?f=${encodeURIComponent(E.saved.file)}" style="color:var(--accent-color)">내려받기</a>`}</div>` : ''}
          <div class="muted">단축키: M 이동 · CO/CP 복사 · U 되돌리기 · Ctrl+S 저장 · Esc 취소. 원본 도면은 고치지 않고 '저장' 폴더에 새 DXF 로 씁니다.</div>`;
        $('eOpen').onclick = () => editOpen();
        if ($('eShow')) $('eShow').onclick = () => window.cadApp.showInFolder(E.saved.path);
        $('eMove').onclick = () => startOp('move'); $('eCopy').onclick = () => startOp('copy');
        $('eUndo').onclick = () => editUndo(); $('eSaveDwg').onclick = () => editSave('dwg'); $('eSaveDxf').onclick = () => editSave('dxf');
        $('eApply').onclick = () => { editApply(E.op === 'copy' ? 'copy' : 'move', parseFloat($('eDx').value), parseFloat($('eDy').value)); if (E.op !== 'copy') { E.sel = null; E.step = 'select'; } renderPanel(); };
      } else if (panelKind === 'font') {
        const fonts = ['"Malgun Gothic", "맑은 고딕"', 'Gulim, 굴림', 'Batang, 바탕', 'Dotum, 돋움', 'Arial, sans-serif', '"Courier New", monospace'];
        panel.innerHTML = `<h4>글자 표시·글꼴 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <label><input type="checkbox" id="fOn" ${app.textsOn ? 'checked' : ''}>글자 보이기</label>
          <label><input type="checkbox" id="fFix" ${app.textFixed === true ? 'checked' : ''}>확대해도 글자 크기 고정 (끄면 캐드처럼 도면과 같이 커지고 작아짐)</label>
          <div>글꼴 <select id="fFont">${fonts.map((f) => `<option value='${f}' ${f === app.textFont ? 'selected' : ''}>${f.split(',')[0].replace(/"/g, '')}</option>`).join('')}</select></div>
          <div>크기 배율 <input type="range" id="fScale" min="50" max="200" step="10" value="${Math.round(app.textScale * 100)}"> <span id="fScaleV">${Math.round(app.textScale * 100)}%</span></div>
          <div class="muted">글자가 "?" 나 네모로 보이면 다른 글꼴로 바꿔 보세요. 도면 글꼴(SHX)은 시스템 글꼴로 대신 그립니다.</div>`;
        $('fOn').onchange = (e) => setFont({ on: e.target.checked });
        $('fFix').onchange = (e) => setFont({ fixed: e.target.checked });
        $('fFont').onchange = (e) => setFont({ font: e.target.value });
        $('fScale').oninput = (e) => { $('fScaleV').textContent = e.target.value + '%'; setFont({ scale: e.target.value / 100 }); };
      }
      const pc = $('pClose'); if (pc) pc.onclick = () => { panel.classList.remove('open'); if (T.tool) setTool(T.tool); panelKind = null; syncBtns(); };
    }
    function setFont(o) {
      if (o.font !== undefined) { app.textFont = o.font; store.set('font', o.font); }
      if (o.scale !== undefined) { app.textScale = o.scale; store.set('scale', o.scale); }
      if (o.on !== undefined) { app.textsOn = !!o.on; store.set('textsOn', !!o.on); }
      if (o.fixed !== undefined) { app.textFixed = !!o.fixed; store.set('fixed', !!o.fixed); }
      app.textsDirty = true; return { font: app.textFont, scale: app.textScale, on: app.textsOn, fixed: app.textFixed };
    }
    function csvText() {
      const o = origin(); const rows = [['번호', '종류', '값', 'ΔX', 'ΔY', '각도', '둘레', 'X', 'Y']];
      T.records.forEach((r, i) => rows.push([i + 1, r.type, r.value ?? '', r.dx ?? '', r.dy ?? '', r.angle !== undefined ? r.angle.toFixed(3) : '', r.perimeter ?? '', r.x ?? '', r.y ?? '']));
      return '﻿' + rows.map((r) => r.join(',')).join('\r\n');
    }
    function downloadCsv() {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv;charset=utf-8' }));
      a.download = ((app.currentFilename || 'cad').replace(/\.[^.]+$/, '')) + '_측정기록.csv'; document.body.appendChild(a); a.click(); a.remove();
    }


    // ── 캐드(AutoCAD) 단축키: 글자를 치면 아래 '명령:' 칸에 들어가고 Enter/Space 로 실행(별칭은 acad.pgp 기본값과 같음) ──
    const cmdBox = document.createElement('div');
    cmdBox.style.cssText = 'position:absolute;left:50%;bottom:44px;transform:translateX(-50%);display:none;z-index:14;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;padding:4px 8px;gap:6px;align-items:center;font-size:13px;backdrop-filter:blur(8px)';
    cmdBox.innerHTML = '<span style="color:var(--text-muted)" id="cmdPrompt">명령:</span><input type="text" id="cmdline" autocomplete="off" spellcheck="false" style="width:180px;height:26px;border-radius:6px;border:1px solid var(--panel-border);background:var(--btn-bg);color:var(--text-main);padding:0 8px;font-size:13px;user-select:text;text-transform:uppercase">';
    view.appendChild(cmdBox);
    const cmdIn = cmdBox.querySelector('#cmdline'), cmdPrompt = cmdBox.querySelector('#cmdPrompt');
    let cmdMode = null;                                                   // 'zoom' 같은 하위 옵션 대기
    const hideCmd = () => { cmdBox.style.display = 'none'; cmdIn.value = ''; cmdMode = null; cmdPrompt.textContent = '명령:'; cmdIn.blur(); };
    const showCmd = (init, prompt) => { cmdBox.style.display = 'flex'; cmdPrompt.textContent = prompt || '명령:'; cmdIn.value = init || ''; cmdIn.focus(); cmdIn.setSelectionRange(cmdIn.value.length, cmdIn.value.length); };
    function fitAll() { if (typeof app.fitToScreen === 'function') app.fitToScreen(); else if (window.cadViewer && window.cadViewer.fit) window.cadViewer.fit(); T.dirty = true; app.textsDirty = true; }
    const toolOn = (t) => { if (T.tool !== t) setTool(t); };
    const CMD = {
      SE: () => toolOn('sel'), SEL: () => toolOn('sel'), SELECT: () => toolOn('sel'),
      M: () => startOp('move'), MOVE: () => startOp('move'),
      CO: () => startOp('copy'), CP: () => startOp('copy'), COPY: () => startOp('copy'),
      U: () => editUndo(), UNDO: () => editUndo(),
      SAVE: () => editSave(), QSAVE: () => editSave(), SAVEAS: () => editSave('dxf'), DXFOUT: () => editSave('dxf'),
      Z: () => { cmdMode = 'zoom'; showCmd('', '줌 [E 전체/W 영역/P 이전/A 전체/배율]:'); }, ZOOM: () => CMD.Z(),
      ZE: () => fitAll(), ZA: () => fitAll(), ZW: () => toolOn('zoomwin'), ZP: () => prevView(),
      PL: () => toolOn('path'), LEN: () => toolOn('path'), DL: () => toolOn('path'),
      DI: () => toolOn('dist'), DIST: () => toolOn('dist'), DISTANCE: () => toolOn('dist'),
      AA: () => toolOn('area'), AREA: () => toolOn('area'),
      ID: () => toolOn('coord'),
      P: () => toast('이동(PAN): 왼쪽 버튼 또는 가운데(휠) 버튼을 누른 채 끌기'), PAN: () => CMD.P(),
      FIND: () => openPanel('find'), FI: () => openPanel('find'),
      LA: () => { const b = document.getElementById('layerToggleBtn') || document.querySelector('[title*="레이어"], #layerBtn'); if (b) b.click(); }, LAYER: () => CMD.LA(),
      RE: () => { app.textsDirty = true; T.dirty = true; }, REGEN: () => CMD.RE(), R: () => CMD.RE(), REDRAW: () => CMD.RE(),
      OP: () => { const b = document.getElementById('openBtn'); if (b) b.click(); }, OPEN: () => CMD.OP(),
      PNG: () => exportPng(true), EXPORT: () => exportPng(true),
      GRID: () => { const g = document.getElementById('gridBtn'); if (g) g.click(); },
      E: () => toast('삭제(ERASE)는 아직 지원하지 않습니다'), ERASE: () => CMD.E(), TR: () => toast('이 명령은 아직 지원하지 않습니다'), L: () => toast('그리기 명령은 지원하지 않습니다(보기·측정·이동·복사만)'), LINE: () => CMD.L(),
      ESC: () => editEnd()
    };
    function runCmd(txt) {
      const c = (txt || '').trim().toUpperCase();
      if (cmdMode === 'zoom') {
        cmdMode = null;
        if (c === '' || c === 'W') toolOn('zoomwin');
        else if (c === 'E' || c === 'A') fitAll();
        else if (c === 'P') prevView();
        else if (/^\d+(\.\d+)?X?$/.test(c)) { const f = parseFloat(c); if (f > 0 && window.cadViewer) window.cadViewer.zoom(f); }
        else toast('알 수 없는 줌 옵션: ' + c);
        return;
      }
      if (!c) { if (T.tool === 'edit' && (E.op || E.sel)) editEnd(); return; }
      const f = CMD[c];
      if (f) f(); else toast(`알 수 없는 명령: ${c}`);
    }
    cmdIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const v = cmdIn.value; const keep = cmdMode === 'zoom'; hideCmd(); if (keep) cmdMode = 'zoom'; runCmd(v); }
      else if (e.key === 'Escape') { e.preventDefault(); hideCmd(); }
    });
    cmdIn.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== cmdIn && !cmdMode) cmdBox.style.display = 'none'; }, 150); });
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); editUndo(); }
        else if (e.key === 's' || e.key === 'S') { e.preventDefault(); editSave(); }
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'F7') { e.preventDefault(); CMD.GRID(); return; }
      if (e.key === 'F3') { e.preventDefault(); SNAP.on = !SNAP.on; store.set('snapOn', SNAP.on); toast('스냅 ' + (SNAP.on ? '켬' : '끔')); renderPanel(); return; }
      if (e.key === 'Delete') { return; }
      if (/^[a-zA-Z0-9]$/.test(e.key)) { e.preventDefault(); showCmd(e.key.toUpperCase()); }
    });

    // 도면을 새로 열면 찾기·측정 기록을 비움
    const origRender = app.renderLite.bind(app);
    app.renderLite = function (buf, name) { fitDist0 = 0; S.sel = []; S.pt = null; S.cand = []; S.src = null; T.find = { q: '', opts: T.find.opts, res: [], cur: -1 }; E.ready = false; E.sel = null; E.ops = []; E.step = 'idle'; E.op = null; E.base = null; E.hover = null; E.saved = null; E.msg = '편집을 시작하려면 [편집 준비]를 누르세요'; T.records = []; T.pts = []; T.hover = null; T.views = []; isolated = null; const r = origRender(buf, name); T.dirty = true; renderPanel(); return r; };

    // 에이전트용 조작 (window.cadTools)
    window.cadTools = {
      find: (q, opts) => find(q, opts), findNext: () => findGo(1), findPrev: () => findGo(-1),
      findResults: () => T.find.res.map((i) => { const t = app.lite.texts[i]; return { text: (t._l || []).join(' '), layer: t.layer, x: t.x + origin()[0], y: t.y + origin()[1] }; }),
      measureDistance: (a, b) => measureDist(a, b), measureArea: (pts) => measureArea(pts), coordinate: (p) => coordAt(p),
      records: () => T.records.map((r) => ({ type: r.type, value: r.value, dx: r.dx, dy: r.dy, angle: r.angle, perimeter: r.perimeter, x: r.x, y: r.y })), clearRecords: () => { T.records = []; T.dirty = true; renderPanel(); },
      csv: () => csvText(), setTool: (t) => { T.tool = null; setTool(t); return T.tool; },
      zoomWindow: (x1, y1, x2, y2) => { const o = origin(); zoomWindow(x1 - o[0], y1 - o[1], x2 - o[0], y2 - o[1]); }, prevView, isolateLayer, setLayerTransparency, setFont,
      edit: { open: editOpen, pick: async (x, y) => { const s = await editPick([x, y]); return s && { handle: s.handle, name: s.name, layer: s.layer, bbox: s.bbox }; }, move: (dx, dy) => editApply('move', dx, dy), copy: (dx, dy) => editApply('copy', dx, dy), undo: editUndo, save: editSave,
        ops: () => E.ops.map((o) => ({ op: o.op, handle: o.handle, name: o.name, dx: o.dx, dy: o.dy })), state: () => ({ ready: E.ready, busy: E.busy, step: E.step, op: E.op, selected: E.sel && E.sel.name, ops: E.ops.length, saved: E.saved, msg: E.msg }), clearSel: () => { E.sel = null; T.dirty = true; } },
      command: (t) => runCmd(t),
      snapDiag: () => `스냅 진단: 가벼운 방식(lite) ${app.lite ? '예' : '아니오 → 스냅 불가'} · 도구 ${T.tool || '없음'} · 스냅 ${SNAP.on ? '켜짐' : '꺼짐'}(끝점 ${SNAP.end ? 'O' : 'X'} 중점 ${SNAP.mid ? 'O' : 'X'} 교차 ${SNAP.int ? 'O' : 'X'}) · 큰 도면 ${isBig() ? '예' : '아니오'} · 마우스 이동 ${DG.moves}회 · 터치 이동 ${DG.touchMoves}회 · 계산 ${DG.picks}회 중 스냅 ${DG.hits}회 · 마지막 계산 ${DG.lastMs}ms · 마지막 스냅 ${DG.lastType}`,
      view: { toScreen: (x, y) => { const o = origin(); const [sx, sy] = w2s(x - o[0], y - o[1]); const r = canvas.getBoundingClientRect(); return [sx + r.left, sy + r.top]; } },
      touch: { state: () => ({ cross: TP.cross, snap: TP.snap && TP.snap.type, bar: tpBar.style.display, one: app.controls.touches.ONE, hover: T.hover, pt: TP.pt, pts: T.pts.length, records: T.records.length, grab: !!TP.grab, loupe: loupe.style.display, loupeSide: loupe.style.left === '12px' ? 'left' : 'right' }), put: tpPut },
      select: { at: (x, y, add) => { const o = origin(); const r = selectAt(x - o[0], y - o[1], !!add); return r && selInfo(r); }, list: () => S.sel.map(selInfo), count: () => objsList().length, clear: () => { S.sel = []; T.dirty = true; renderPanel(); }, zoom: () => selZoom(), candidates: () => S.cand.map(selInfo) },
      snap: { at: (x, y, px) => { const o = origin(); const rw = (px || 14) / pxPerUnit(); const r = snapAt(x - o[0], y - o[1], rw, false); return r && { x: r.p[0] + o[0], y: r.p[1] + o[1], type: r.type }; }, set: (o) => { Object.assign(SNAP, o); return Object.assign({}, SNAP); }, get: () => Object.assign({}, SNAP) },
      exportPng: () => exportPng(false), downloadPng: () => exportPng(true), openPanel, state: () => ({ tool: T.tool, finds: T.find.res.length, records: T.records.length, views: T.views.length, panel: panelKind })
    };
    app.updateLayerPanel();
    T.ready = true;
  }
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
})();

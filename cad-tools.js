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

    const T = {
      tool: null,                 // null | 'dist' | 'area' | 'coord' | 'zoomwin'
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

    function snapPoint(wx, wy, rw) {
      if (!app.lite) return null;
      let best = null, bd = rw * rw;
      for (const L of app.lite.lines) {
        if (!L.obj.parent || !L.obj.parent.visible) continue;
        const a = L.obj.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i += 2) {
          const dx = a[i] - wx, dy = a[i + 1] - wy, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = [a[i], a[i + 1]]; }
        }
      }
      return best;
    }
    const totalVerts = () => (app.lite ? app.lite.lines.reduce((n, l) => n + l.obj.geometry.attributes.position.count, 0) : 0);

    function pickPoint(px, py, forceSnap) {
      const [wx, wy] = s2w(px, py);
      const rw = 14 / pxPerUnit();
      const s = (forceSnap || totalVerts() < 8e6) ? snapPoint(wx, wy, rw) : null;
      return { p: s || [wx, wy], snapped: !!s };
    }
    function absOf(p) { const o = origin(); return [p[0] + o[0], p[1] + o[1]]; }

    function finishArea() {
      if (T.pts.length >= 3) measureArea(T.pts.map(absOf));
      else toast('점이 3개 이상 필요합니다');
      T.pts = []; T.hover = null; T.dirty = true;
    }
    function onClick(px, py) {
      if (!T.tool || !isLite()) return;
      const { p } = pickPoint(px, py, true);
      if (T.tool === 'dist') {
        T.pts.push(p);
        if (T.pts.length === 2) { measureDist(absOf(T.pts[0]), absOf(T.pts[1])); T.pts = []; T.hover = null; }
      } else if (T.tool === 'area') T.pts.push(p);
      else if (T.tool === 'coord') coordAt(absOf(p));
      T.dirty = true; renderPanel();
    }

    // ── 입력 연결 ──
    const canvas = app.renderer.domElement;
    let down = null, lastHover = 0, zw = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: e.button }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const btn = down.t; down = null;
      if (moved < 6 && btn === 0 && ['dist', 'area', 'coord'].includes(T.tool)) { const r = canvas.getBoundingClientRect(); onClick(e.clientX - r.left, e.clientY - r.top); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!['dist', 'area'].includes(T.tool) || !T.pts.length || !isLite()) return;
      const now = performance.now(); if (now - lastHover < 70) return; lastHover = now;
      const r = canvas.getBoundingClientRect(); T.hover = pickPoint(e.clientX - r.left, e.clientY - r.top, false).p; T.dirty = true;
    });
    canvas.addEventListener('dblclick', () => { if (T.tool === 'area' && T.pts.length > 3) { T.pts.pop(); finishArea(); renderPanel(); } });
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
      if (e.key === 'Escape') { T.pts = []; T.hover = null; setTool(null); T.dirty = true; }
      else if (e.key === 'Enter' && T.tool === 'area') { finishArea(); renderPanel(); }
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
      const colors = { 거리: '#00e5ff', 면적: '#7CFC00', 좌표: '#ffb300' };
      const drawPts = (pts, color, closed, fill) => {
        if (!pts.length) return; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); if (closed) ctx.closePath();
        if (fill) { ctx.save(); ctx.globalAlpha = 0.18; ctx.fill(); ctx.restore(); } ctx.stroke();
        pts.forEach((p) => { const [x, y] = w2s(p[0], p[1]); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); });
      };
      T.records.forEach((r) => {
        const c = colors[r.type]; drawPts(r.pts, c, r.type === '면적', r.type === '면적');
        const m = r.pts.reduce((a, p) => [a[0] + p[0] / r.pts.length, a[1] + p[1] / r.pts.length], [0, 0]); const [x, y] = w2s(m[0], m[1]);
        label(ctx, x, y, r.type === '거리' ? fmt(r.value) : r.type === '면적' ? fmt(r.value) : `${fmt(r.x)}, ${fmt(r.y)}`);
      });
      if (T.pts.length) {
        const pts = T.hover ? T.pts.concat([T.hover]) : T.pts; drawPts(pts, '#ffffff', false, false);
        if (T.hover && T.tool === 'dist') { const a = T.pts[T.pts.length - 1]; const [x, y] = w2s((a[0] + T.hover[0]) / 2, (a[1] + T.hover[1]) / 2); label(ctx, x, y, fmt(dist2(a, T.hover))); }
        if (T.hover && T.tool === 'area' && T.pts.length >= 2) { const [x, y] = w2s(T.hover[0], T.hover[1]); label(ctx, x, y - 6, fmt(polyArea(pts))); }
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
    const defs = [['find', '찾기', '글자 찾기'], ['dist', '거리', '두 점 거리 (끝점 자동 맞춤)'], ['area', '면적', '여러 점으로 면적·둘레 (Enter/더블클릭 완료)'], ['coord', '좌표', '점 좌표 보기'],
      ['zoomwin', '영역', '끌어서 영역 확대'], ['prev', '이전', '이전 보기'], ['font', '글꼴', '글자 표시·글꼴 설정'], ['png', 'PNG', '지금 화면을 PNG로 저장']];
    const btns = {};
    defs.forEach(([k, txt, tip]) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = txt; b.title = tip; b.dataset.k = k; bar.appendChild(b); btns[k] = b; });
    view.appendChild(bar);
    const panel = document.createElement('div'); panel.id = 'cad-panel'; view.appendChild(panel);
    let panelKind = null;

    function setTool(t) {
      if (t && !isLite() && t !== 'prev' && t !== 'png') { toast('큰 도면(DWG·DXF) 모드에서 쓸 수 있습니다'); return; }
      T.tool = (T.tool === t) ? null : t; T.pts = []; T.hover = null; T.dirty = true;
      Object.keys(btns).forEach((k) => btns[k].classList.toggle('active', k === T.tool || (k === panelKind && panel.classList.contains('open'))));
      canvas.style.cursor = T.tool ? 'crosshair' : '';
      if (['dist', 'area', 'coord'].includes(T.tool)) { panelKind = 'measure'; panel.classList.add('open'); }
      else if (T.tool === null && panelKind === 'measure') panel.classList.remove('open');
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
      syncBtns();
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
        const hint = { dist: '두 점을 차례로 누르세요 (끝점에 자동으로 붙습니다)', area: '점을 차례로 누르고 Enter 또는 더블클릭으로 끝내세요 · Backspace 한 점 취소', coord: '좌표를 볼 점을 누르세요' }[T.tool] || '아래 측정 도구를 고르세요';
        panel.innerHTML = `<h4>측정 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <div class="muted">${hint}${T.tool === 'area' ? ` · 현재 ${T.pts.length}점` : ''}</div>
          <div class="row">${T.tool === 'area' ? '<button class="btn" id="mDone">면적 완료</button>' : ''}<button class="btn" id="mClear">기록 지우기</button><button class="btn" id="mCsv">CSV 저장</button></div>
          <div class="list">${T.records.map((r, i) => `<div class="item"><b>${i + 1}</b><span>${r.type === '거리' ? `거리 ${fmt(r.value)} (ΔX ${fmt(r.dx)}, ΔY ${fmt(r.dy)}, ${r.angle.toFixed(1)}°)` : r.type === '면적' ? `면적 ${fmt(r.value)} · 둘레 ${fmt(r.perimeter)}` : `X ${fmt(r.x)}, Y ${fmt(r.y)}`}</span></div>`).join('') || '<span class="muted">기록이 없습니다</span>'}</div>
          <div class="muted">값은 도면 단위(mm 도면이면 mm, 면적은 mm²)입니다.</div>`;
        if ($('mDone')) $('mDone').onclick = () => { finishArea(); renderPanel(); };
        $('mClear').onclick = () => { T.records = []; T.pts = []; T.hover = null; T.dirty = true; renderPanel(); };
        $('mCsv').onclick = () => downloadCsv();
      } else if (panelKind === 'font') {
        const fonts = ['"Malgun Gothic", "맑은 고딕"', 'Gulim, 굴림', 'Batang, 바탕', 'Dotum, 돋움', 'Arial, sans-serif', '"Courier New", monospace'];
        panel.innerHTML = `<h4>글자 표시·글꼴 <button class="btn btn-icon-only" id="pClose" style="border:none;height:22px;width:22px">✕</button></h4>
          <label><input type="checkbox" id="fOn" ${app.textsOn ? 'checked' : ''}>글자 보이기</label>
          <div>글꼴 <select id="fFont">${fonts.map((f) => `<option value='${f}' ${f === app.textFont ? 'selected' : ''}>${f.split(',')[0].replace(/"/g, '')}</option>`).join('')}</select></div>
          <div>크기 배율 <input type="range" id="fScale" min="50" max="200" step="10" value="${Math.round(app.textScale * 100)}"> <span id="fScaleV">${Math.round(app.textScale * 100)}%</span></div>
          <div class="muted">글자가 "?" 나 네모로 보이면 다른 글꼴로 바꿔 보세요. 도면 글꼴(SHX)은 시스템 글꼴로 대신 그립니다.</div>`;
        $('fOn').onchange = (e) => setFont({ on: e.target.checked });
        $('fFont').onchange = (e) => setFont({ font: e.target.value });
        $('fScale').oninput = (e) => { $('fScaleV').textContent = e.target.value + '%'; setFont({ scale: e.target.value / 100 }); };
      }
      const pc = $('pClose'); if (pc) pc.onclick = () => { panel.classList.remove('open'); if (T.tool) setTool(T.tool); panelKind = null; syncBtns(); };
    }
    function setFont(o) {
      if (o.font !== undefined) { app.textFont = o.font; store.set('font', o.font); }
      if (o.scale !== undefined) { app.textScale = o.scale; store.set('scale', o.scale); }
      if (o.on !== undefined) { app.textsOn = !!o.on; store.set('textsOn', !!o.on); }
      app.textsDirty = true; return { font: app.textFont, scale: app.textScale, on: app.textsOn };
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

    // 도면을 새로 열면 찾기·측정 기록을 비움
    const origRender = app.renderLite.bind(app);
    app.renderLite = function (buf, name) { T.find = { q: '', opts: T.find.opts, res: [], cur: -1 }; T.records = []; T.pts = []; T.hover = null; T.views = []; isolated = null; const r = origRender(buf, name); T.dirty = true; renderPanel(); return r; };

    // 에이전트용 조작 (window.cadTools)
    window.cadTools = {
      find: (q, opts) => find(q, opts), findNext: () => findGo(1), findPrev: () => findGo(-1),
      findResults: () => T.find.res.map((i) => { const t = app.lite.texts[i]; return { text: (t._l || []).join(' '), layer: t.layer, x: t.x + origin()[0], y: t.y + origin()[1] }; }),
      measureDistance: (a, b) => measureDist(a, b), measureArea: (pts) => measureArea(pts), coordinate: (p) => coordAt(p),
      records: () => T.records.map((r) => ({ type: r.type, value: r.value, dx: r.dx, dy: r.dy, angle: r.angle, perimeter: r.perimeter, x: r.x, y: r.y })), clearRecords: () => { T.records = []; T.dirty = true; renderPanel(); },
      csv: () => csvText(), setTool: (t) => { T.tool = null; setTool(t); return T.tool; },
      zoomWindow: (x1, y1, x2, y2) => { const o = origin(); zoomWindow(x1 - o[0], y1 - o[1], x2 - o[0], y2 - o[1]); }, prevView, isolateLayer, setLayerTransparency, setFont,
      exportPng: () => exportPng(false), downloadPng: () => exportPng(true), openPanel, state: () => ({ tool: T.tool, finds: T.find.res.length, records: T.records.length, views: T.views.length, panel: panelKind })
    };
    app.updateLayerPanel();
  }
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
})();

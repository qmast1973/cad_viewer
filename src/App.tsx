import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CadModel,
  CadEntity,
  MeasureResult,
  AreaResult
} from './core/cad-model.ts';
import { DwgLoader } from './core/dwg-loader.ts';
import { CadCanvas, CadToolMode } from './components/CadCanvas.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { CommandBar } from './components/CommandBar.tsx';
import { PropertyPanel } from './components/PropertyPanel.tsx';
import { makeLiteBlob, readLiteBlob, LITE_EXTENSION } from './core/cadlite.ts';
import { MobileTopBar, MobileMenu, MobileToolBar, MobileActionStack, useIsMobile } from './components/MobileBars.tsx';

export const App: React.FC = () => {
  const isMobile = useIsMobile();
  // 모바일 전용 화면 상태: 메뉴, 속성 시트, 명령창, 완료/취소 신호
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false); // 속성창: 개체를 눌렀을 때(또는 ℹ️ 버튼)만 보인다
  const infoManualRef = useRef(false); // ℹ️ 버튼으로 직접 연 경우, 빈 곳을 눌러도 닫지 않는다
  const [commandVisible, setCommandVisible] = useState(false);
  const [commandSignal, setCommandSignal] = useState({ id: 0 });
  const modelRef = useRef<CadModel>(new CadModel());
  const openedNameRef = useRef('drawing'); // 마지막으로 연 도면 이름 (저장 파일 이름에 사용)
  const [, setForceUpdate] = useState(0);
  const [zoomTrigger, setZoomTrigger] = useState(1);

  // 상호작용 및 뷰 상태
  const [mode, setMode] = useState<CadToolMode>('SELECT');
  const [orthoEnabled, setOrthoEnabled] = useState<boolean>(false);
  const [osnapEnabled, setOsnapEnabled] = useState<boolean>(true);
  const [textVisible, setTextVisible] = useState<boolean>(true);
  const [gridEnabled, setGridEnabled] = useState<boolean>(true);
  const [theme, setTheme] = useState<'DARK' | 'LIGHT'>('DARK');

  // 측정 및 선택 상태
  const [lastMeasure, setLastMeasure] = useState<MeasureResult | null>(null);
  const [lastArea, setLastArea] = useState<AreaResult | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<CadEntity | null>(null);

  const [logs, setLogs] = useState<string[]>([
    'AutoCAD / CADian 호환 Web CAD Studio v2.0이 준비되었습니다.',
    '도면 파일(DWG, DXF)을 상단 "📂 열기"로 불러오거나 치수/면적 측정 도구를 활용하십시오.'
  ]);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-50), msg]);
  }, []);

  const triggerUpdate = useCallback(() => {
    setForceUpdate(v => v + 1);
  }, []);

  const triggerZoomExtents = useCallback(() => {
    setZoomTrigger(v => v + 1);
  }, []);

  // 기본 표준 샘플 도면 생성
  useEffect(() => {
    loadDefaultSample();
  }, []);

  const loadDefaultSample = () => {
    const model = modelRef.current;
    model.clear();
    model.resetLayers(true); // 파일을 열었다가 샘플로 돌아와도 샘플 레이어가 보이도록 복원

    // 외벽 사각형 (WALL 레이어)
    model.addLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 'WALL', '#00FFFF');
    model.addLine({ x: 100, y: 0 }, { x: 100, y: 100 }, 'WALL', '#00FFFF');
    model.addLine({ x: 100, y: 100 }, { x: 0, y: 100 }, 'WALL', '#00FFFF');
    model.addLine({ x: 0, y: 100 }, { x: 0, y: 0 }, 'WALL', '#00FFFF');

    // 기둥 원 (COLUMN 레이어)
    model.addCircle({ x: 50, y: 50 }, 15, 'COLUMN', '#FF5555');
    model.addCircle({ x: 20, y: 20 }, 6, 'COLUMN', '#FF5555');
    model.addCircle({ x: 80, y: 80 }, 6, 'COLUMN', '#FF5555');

    // 대각 보조선 및 주석
    model.addText('샘플 룸 (100x100mm)', { x: 25, y: 85 }, 4, 0, 'WALL', '#FFE873');
    model.addText('중앙 기둥 (R15)', { x: 35, y: 40 }, 3, 0, 'COLUMN', '#FF5555');

    triggerUpdate();
    setTimeout(triggerZoomExtents, 60);
    addLog('표준 샘플 도면이 로드되었습니다. (외벽 4선, 기둥 3원, 텍스트 라벨)');
  };

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Undo/Redo/Copy/Paste/Delete
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (modelRef.current.undo()) {
          triggerUpdate();
          addLog('✓ 실행 취소 (Undo)');
        } else {
          addLog('✗ 취소할 작업이 없습니다.');
        }
      } else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        if (modelRef.current.redo()) {
          triggerUpdate();
          addLog('✓ 다시 실행 (Redo)');
        } else {
          addLog('✗ 다시 할 작업이 없습니다.');
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        modelRef.current.copy();
        const count = modelRef.current.getSelectedIds().size;
        if (count > 0) {
          addLog(`✓ ${count}개 개체 복사됨 (Ctrl+C)`);
        } else {
          addLog('선택된 개체가 없습니다.');
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const pasted = modelRef.current.paste(5, 5);
        if (pasted.length > 0) {
          triggerUpdate();
          addLog(`✓ ${pasted.length}개 개체 붙여넣기 완료 (Ctrl+V)`);
        } else {
          addLog('복사된 개체가 없습니다.');
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (modelRef.current.deleteSelected()) {
          triggerUpdate();
          addLog('✓ 선택된 개체 삭제됨');
        } else {
          addLog('선택된 개체가 없습니다.');
        }
      } else if (e.key === 'F8' || e.key === 'f8') {
        e.preventDefault();
        setOrthoEnabled(v => {
          const next = !v;
          addLog(`직교 모드(F8): ${next ? 'ON' : 'OFF'}`);
          return next;
        });
      } else if (e.key === 'F3' || e.key === 'f3') {
        e.preventDefault();
        setOsnapEnabled(v => {
          const next = !v;
          addLog(`객체 스냅(F3): ${next ? 'ON' : 'OFF'}`);
          return next;
        });
      } else if (e.key === 'F7' || e.key === 'f7') {
        e.preventDefault();
        setGridEnabled(v => {
          const next = !v;
          addLog(`배경 그리드(F7): ${next ? 'ON' : 'OFF'}`);
          return next;
        });
      } else if (e.key === 'Escape') {
        setMode('SELECT');
        setSelectedEntity(null);
        addLog('*명령 취소됨* (선택 모드)');
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey) {
        setMode('PAN');
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) {
        setMode('MOVE');
      } else if (e.key.toLowerCase() === 'l' && !e.ctrlKey) {
        setMode('LINE');
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey) {
        setMode('CIRCLE');
      } else if (e.key.toLowerCase() === 'd' && !e.ctrlKey) {
        setMode('DIST');
      } else if (e.key.toLowerCase() === 'a' && !e.ctrlKey) {
        setMode('AREA');
      } else if (e.key.toLowerCase() === 'z' && !e.ctrlKey) {
        triggerZoomExtents();
      } else if (e.key.toLowerCase() === 't' && !e.ctrlKey) {
        setTextVisible(v => {
          const next = !v;
          addLog(`도면 문자 표시(T): ${next ? 'ON' : 'OFF'}`);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addLog, triggerZoomExtents, triggerUpdate]);

  // 도면 파일 열기 (DWG / DXF 자동 판별 및 자가 복구)
  const handleOpenFile = async (file: File) => {
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    openedNameRef.current = fileName.slice(0, Math.max(1, fileName.lastIndexOf(String.fromCharCode(46))));
    addLog(`도면 파일 열기 시도: ${fileName} (${(file.size / 1024).toFixed(1)} KB)...${file.size > 5 * 1024 * 1024 && !lowerName.endsWith(LITE_EXTENSION) ? ' 큰 도면은 1분 정도 걸릴 수 있습니다.' : ''}`);

    try {
      // 가벼운 도면(.cadlite): 서버 없이 바로 열린다
      if (lowerName.endsWith(LITE_EXTENSION)) {
        const t0 = performance.now();
        const dec = await readLiteBlob(file);
        const res = modelRef.current.loadLite(dec);
        openedNameRef.current = fileName.slice(0, Math.max(1, fileName.lastIndexOf(String.fromCharCode(46))));
        triggerUpdate();
        setTimeout(triggerZoomExtents, 80);
        const bbox = modelRef.current.getBoundingBox();
        const dimStr = bbox ? `[도면 크기: ${bbox.width.toFixed(1)} × ${bbox.height.toFixed(1)} mm]` : '';
        addLog(`✓ 가벼운 도면 로드 완료 (${((performance.now() - t0) / 1000).toFixed(1)}초): 선분 ${res.lineCount}개, 원 ${res.circleCount}개, 문자 ${res.textCount}개. ${dimStr}`);
        if (modelRef.current.getStaticLineCount() > 0) {
          addLog('ℹ 대용량 도면 모드: 선은 보기·측정용(선택·이동·스냅 불가)으로 표시합니다. 문자는 충분히 확대하면 보이는 범위만 표시됩니다.');
        }
        return;
      }

      const buffer = await file.arrayBuffer();
      const isDxfExt = lowerName.endsWith('.dxf');
      const isDwgExt = lowerName.endsWith('.dwg');

      if (!isDxfExt && !isDwgExt) {
        addLog('⚠️ 경고: .dwg, .dxf, .cadlite 확장자 파일만 지원됩니다.');
        return;
      }

      const parseAsDxf = async (buf: ArrayBuffer, note?: string) => {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        const res = modelRef.current.loadFromDxf(text);
        triggerUpdate();
        setTimeout(triggerZoomExtents, 80);
        const bbox = modelRef.current.getBoundingBox();
        const dimStr = bbox ? `[도면 크기: ${bbox.width.toFixed(1)} × ${bbox.height.toFixed(1)} mm]` : '';
        const extra = note ? ` (${note})` : '';
        addLog(`✓ DXF 로드 완료${extra}: 선분 ${res.lineCount}개, 원 ${res.circleCount}개, 문자 ${res.textCount}개 적재. ${dimStr}`);
      };

      if (isDwgExt) {
        try {
          const res = await DwgLoader.loadDwgIntoModel(buffer, modelRef.current);
          triggerUpdate();
          setTimeout(triggerZoomExtents, 80);
          const bbox = modelRef.current.getBoundingBox();
          const dimStr = bbox ? `[도면 크기: ${bbox.width.toFixed(1)} × ${bbox.height.toFixed(1)} mm]` : '';
          const verStr = res.versionName ? `[${res.versionName}] ` : '';
          addLog(`✓ ${verStr}DWG 로드 완료: 선분 ${res.lineCount}개, 원 ${res.circleCount}개, 문자 ${res.textCount}개 적재. ${dimStr}`);
          if (modelRef.current.getStaticLineCount() > 0) {
            // 대용량 도면: 선분은 읽기 전용 배경으로 그리고, 문자는 확대했을 때 보이는 범위만 그린다
            addLog('ℹ 대용량 도면 모드: 선은 보기·측정용(선택·이동·스냅 불가)으로 표시합니다. 문자는 충분히 확대하면 보이는 범위만 표시됩니다.');
          }
          if (res.skipped && Object.keys(res.skipped).length > 0) {
            addLog(`⚠ 지원하지 않아 표시하지 못한 개체: ${Object.entries(res.skipped).map(([t, n]) => `${t} ${n}개`).join(', ')}`);
          }
        } catch (dwgErr: any) {
          if (dwgErr.message === 'IS_DXF_FILE') {
            addLog('ℹ️ 파일 내용이 DXF 텍스트 형식으로 감지되어 DXF 고속 모드로 전환합니다...');
            await parseAsDxf(buffer, 'DXF 자동 전환');
            return;
          }
          // DWG 파싱 오류 또는 WASM 오류 - DXF로 자동 폴백 (사용자에게 오류 메시지 없음)
          if (dwgErr.message && (dwgErr.message.includes('WebAssembly') || dwgErr.message.includes('DWG_PARSE_FAILED'))) {
            console.debug('DWG parsing failed, attempting DXF fallback:', dwgErr.message);
            try {
              await parseAsDxf(buffer, 'DXF 자동 처리');
              return;
            } catch (_) {
              const serverMsg = DwgLoader.lastServerError;
              const engineMsg = String(dwgErr.message || '').replace('DWG_PARSE_FAILED|', '');
              const noServer = !!serverMsg && (serverMsg.includes('변환 서버가 없습니다') || serverMsg.includes('연결하지 못했습니다'));
              const lines = ['DWG와 DXF 모두 로드 실패.'];
              if (serverMsg) lines.push(`서버 변환 결과: ${serverMsg}`);
              lines.push(`내장 엔진 결과: ${engineMsg}`);
              // 변환 서버가 없는 주소(예: GitHub Pages)에서는 큰 DWG를 내장 엔진으로 열 수 없다
              if (noServer || file.size > 5 * 1024 * 1024) {
                lines.push('→ 큰 DWG는 변환 서버가 있는 로컬 실행(npm run dev)에서만 열립니다. 웹 배포 주소에서는 열 수 없습니다.');
              } else {
                lines.push('→ 올바른 CAD 파일인지 확인하십시오.');
              }
              throw new Error(lines.join('\n'));
            }
          }
          throw dwgErr;
        }
      } else if (isDxfExt) {
        try {
          await parseAsDxf(buffer);
        } catch (dxfErr: any) {
          const headerBytes = new Uint8Array(buffer.slice(0, 6));
          const headerStr = String.fromCharCode(...headerBytes);
          if (headerStr.startsWith('AC')) {
            console.debug('DXF extension but binary DWG header detected, attempting DWG mode...');
            try {
              const res = await DwgLoader.loadDwgIntoModel(buffer, modelRef.current);
              triggerUpdate();
              setTimeout(triggerZoomExtents, 80);
              const bbox = modelRef.current.getBoundingBox();
              const dimStr = bbox ? `[도면 크기: ${bbox.width.toFixed(1)} × ${bbox.height.toFixed(1)} mm]` : '';
              addLog(`✓ DWG 모드 로드 성공: 선분 ${res.lineCount}개, 원 ${res.circleCount}개, 문자 ${res.textCount}개. ${dimStr}`);
              return;
            } catch (dwgErr2: any) {
              console.debug('DWG mode also failed:', dwgErr2.message);
              throw dxfErr;
            }
          }
          throw dxfErr;
        }
      }
    } catch (err: any) {
      console.error('File load error:', err);
      const lines = (err.message || String(err)).split('\n');
      for (const line of lines) {
        if (line.trim()) {
          addLog(`❌ ${line}`);
        }
      }
    }
  };

  // 도면 내보내기 (AutoCAD / CADian 호환 파일 다운로드)
  const handleExport = () => {
    try {
      const blob = modelRef.current.exportDxfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cad_drawing_${Date.now()}.dxf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog('✓ DXF 저장 완료. (채움(HATCH)은 채움 없이 경계선으로 저장됩니다)');
      if (modelRef.current.getStaticLineCount() > 0) addLog('ℹ 대용량 도면의 선분은 화면용 정밀도(약 0.01 이내 오차)로 저장됩니다.');
    } catch (err: any) {
      addLog(`도면 내보내기 실패: ${err.message || err}`);
    }
  };

  // 가벼운 도면(.cadlite) 저장: 큰 도면을 한 번 변환해 두면 서버 없이 어디서나 몇 초 만에 열린다
  const handleExportLite = async () => {
    try {
      addLog('가벼운 도면(.cadlite)을 만드는 중... (큰 도면은 수십 초 걸릴 수 있습니다)');
      const snap = modelRef.current.getLiteSnapshot(openedNameRef.current);
      const blob = await makeLiteBlob(snap.header, snap.batches);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${openedNameRef.current}${LITE_EXTENSION}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      addLog(`✓ 가벼운 도면 저장 완료 (${(blob.size / 1048576).toFixed(1)} MB). 이 파일은 서버 없이 어디서나 열 수 있습니다.`);
    } catch (err: any) {
      addLog(`가벼운 도면 저장 실패: ${err.message || err}`);
    }
  };

  const handleClear = () => {
    modelRef.current.clear();
    setLastMeasure(null);
    setLastArea(null);
    setSelectedEntity(null);
    triggerUpdate();
    addLog('도면이 초기화되었습니다.');
  };

  const handleLayerToggle = (layerName: string) => {
    modelRef.current.toggleLayerVisibility(layerName);
    triggerUpdate();
  };

  const isLight = theme === 'LIGHT';

  // 모바일 하단 도구 바의 실행 취소 / 다시 실행 / 삭제 (데스크톱의 Ctrl+Z, Ctrl+Y, Delete와 같은 동작)
  const handleUndo = () => {
    if (modelRef.current.undo()) { triggerUpdate(); addLog('✓ 실행 취소'); } else addLog('✗ 취소할 작업이 없습니다.');
  };
  const handleRedo = () => {
    if (modelRef.current.redo()) { triggerUpdate(); addLog('✓ 다시 실행'); } else addLog('✗ 다시 할 작업이 없습니다.');
  };
  const handleDeleteSelected = () => {
    if (modelRef.current.deleteSelected()) {
      setSelectedEntity(null);
      triggerUpdate();
      addLog('✓ 선택된 개체 삭제됨');
    } else {
      addLog('선택된 개체가 없습니다. 먼저 [선택]에서 개체를 누르세요.');
    }
  };

  // 개체를 누르면 속성창을 열고, 빈 곳을 누르면(직접 열지 않았다면) 닫는다
  const handleSelectEntity = (ent: CadEntity | null) => {
    setSelectedEntity(ent);
    if (ent) { setInfoOpen(true); setMenuOpen(false); }
    else if (!infoManualRef.current) setInfoOpen(false);
  };
  const handleToggleInfo = () => {
    const next = !infoOpen;
    infoManualRef.current = next;
    setInfoOpen(next);
    setMenuOpen(false);
  };
  const handleCloseInfo = () => { infoManualRef.current = false; setInfoOpen(false); };

  if (isMobile) {
    const drawing = mode === 'LINE' || mode === 'CIRCLE' || mode === 'DIST' || mode === 'AREA';
    const floatBtn = (bg: string): React.CSSProperties => ({
      minWidth: 54, height: 34, padding: '0 12px', border: 'none', borderRadius: 17, color: '#fff',
      backgroundColor: bg, fontSize: 13, fontWeight: 'bold', boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
    });
    return (
      <div
        className="app-root"
        style={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden', backgroundColor: isLight ? '#f6f8fa' : '#161b22' }}
      >
        <MobileTopBar
          theme={theme}
          menuOpen={menuOpen}
          infoOpen={infoOpen}
          onOpenFile={handleOpenFile}
          onExport={handleExport}
          onToggleInfo={handleToggleInfo}
          onToggleMenu={() => { setMenuOpen(v => !v); if (!menuOpen) handleCloseInfo(); }}
        />

        {/* 도면 화면: 남은 공간을 모두 채운다. 메뉴·속성 시트는 도면 위에 겹쳐 표시(도면 크기가 변하지 않음) */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <CadCanvas
            model={modelRef.current}
            mode={mode}
            orthoEnabled={orthoEnabled}
            osnapEnabled={osnapEnabled}
            textVisible={textVisible}
            gridEnabled={gridEnabled}
            theme={theme}
            zoomTrigger={zoomTrigger}
            commandSignal={commandSignal}
            onMeasureComplete={res => setLastMeasure(res)}
            onAreaComplete={res => setLastArea(res)}
            onSelectEntity={handleSelectEntity}
            onModelChange={triggerUpdate}
            onLogMessage={addLog}
          />

          {/* 최근 안내 메시지 한 줄 (측정 결과 등) */}
          <div
            style={{
              position: 'absolute', top: 6, left: 8, right: 60, pointerEvents: 'none', fontSize: 12, lineHeight: 1.35,
              color: isLight ? '#24292f' : '#e6edf3', textShadow: isLight ? '0 0 3px #fff' : '0 0 3px #000',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
            }}
          >
            {logs[logs.length - 1]}
          </div>

          <MobileActionStack
            theme={theme}
            onZoomExtents={triggerZoomExtents}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDelete={handleDeleteSelected}
          />

          {/* 그리는 중에는 우클릭 대신 쓰는 완료/취소 버튼 */}
          {drawing && (
            <div style={{ position: 'absolute', right: 12, bottom: infoOpen ? '52%' : 36, display: 'flex', gap: 8, zIndex: 5 }}>
              {mode === 'AREA' && (
                <button style={floatBtn('#238636')} onClick={() => setCommandSignal(s => ({ id: s.id + 1 }))}>✔ 완료</button>
              )}
              <button
                style={floatBtn('#6e7681')}
                onClick={() => { setMode('SELECT'); }}
              >✖ 종료</button>
            </div>
          )}

          {menuOpen && (
            <MobileMenu
              theme={theme}
              textVisible={textVisible}
              orthoEnabled={orthoEnabled}
              osnapEnabled={osnapEnabled}
              gridEnabled={gridEnabled}
              commandVisible={commandVisible}
              onLoadSample={loadDefaultSample}
              onExportLite={() => { setMenuOpen(false); handleExportLite(); }}
              onClear={handleClear}
              onToggleText={() => setTextVisible(v => !v)}
              onToggleOrtho={() => setOrthoEnabled(v => !v)}
              onToggleOsnap={() => setOsnapEnabled(v => !v)}
              onToggleGrid={() => setGridEnabled(v => !v)}
              onToggleTheme={() => setTheme(t => (t === 'DARK' ? 'LIGHT' : 'DARK'))}
              onToggleCommand={() => setCommandVisible(v => !v)}
              onClose={() => setMenuOpen(false)}
            />
          )}

          {/* 속성 시트: 개체를 누르거나 ℹ️ 버튼을 눌렀을 때만 아래에서 올라온다 */}
          {infoOpen && (
            <div
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '50%', zIndex: 10, display: 'flex', flexDirection: 'column',
                backgroundColor: isLight ? '#f6f8fa' : '#1c2128', borderTop: `1px solid ${isLight ? '#d0d7de' : '#30363d'}`,
                boxShadow: '0 -4px 14px rgba(0,0,0,0.35)', borderRadius: '12px 12px 0 0',
                overflow: 'hidden', contain: 'paint' // 시트가 겹쳐도 아래의 도면(WebGL) 화면이 비지 않도록 그리기 범위를 시트 안으로 제한
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 10px', color: isLight ? '#24292f' : '#c9d1d9', fontSize: 12, fontWeight: 'bold' }}>
                <span>속성 / 측정 결과 / 레이어</span>
                <button
                  onClick={handleCloseInfo}
                  aria-label="닫기"
                  style={{ width: 36, height: 28, border: 'none', background: 'transparent', color: 'inherit', fontSize: 15 }}
                >✕</button>
              </div>
              <div style={{ overflowY: 'auto', minHeight: 0 }}>
                <PropertyPanel
                  model={modelRef.current}
                  lastMeasure={lastMeasure}
                  lastArea={lastArea}
                  selectedEntity={selectedEntity}
                  theme={theme}
                  width="100%"
                  onLayerToggle={handleLayerToggle}
                />
              </div>
            </div>
          )}
        </div>

        {commandVisible && (
          <CommandBar logs={logs} setMode={setMode} onClear={handleClear} onLogMessage={addLog} />
        )}

        <MobileToolBar theme={theme} mode={mode} setMode={setMode} />
      </div>
    );
  }

  return (
    <div
      className="app-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        overflow: 'hidden',
        backgroundColor: isLight ? '#f6f8fa' : '#161b22'
      }}
    >
      {/* 1. 상단 전문 CAD 뷰어 툴바 */}
      <Toolbar
        mode={mode}
        setMode={setMode}
        orthoEnabled={orthoEnabled}
        setOrthoEnabled={setOrthoEnabled}
        osnapEnabled={osnapEnabled}
        setOsnapEnabled={setOsnapEnabled}
        textVisible={textVisible}
        setTextVisible={setTextVisible}
        gridEnabled={gridEnabled}
        setGridEnabled={setGridEnabled}
        theme={theme}
        setTheme={setTheme}
        onOpenFile={handleOpenFile}
        onLoadSample={loadDefaultSample}
        onExport={handleExport}
        onExportLite={handleExportLite}
        onClear={handleClear}
        onZoomExtents={triggerZoomExtents}
        infoOpen={infoOpen}
        onToggleInfo={handleToggleInfo}
      />

      {/* 2. 중앙 메인 작업 영역 (Three.js 캔버스 + 속성창) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Three.js 2D CAD 뷰어 캔버스 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <CadCanvas
            model={modelRef.current}
            mode={mode}
            orthoEnabled={orthoEnabled}
            osnapEnabled={osnapEnabled}
            textVisible={textVisible}
            gridEnabled={gridEnabled}
            theme={theme}
            zoomTrigger={zoomTrigger}
            onMeasureComplete={res => setLastMeasure(res)}
            onAreaComplete={res => setLastArea(res)}
            onSelectEntity={handleSelectEntity}
            onModelChange={triggerUpdate}
            onLogMessage={addLog}
          />
        </div>

        {/* 우측 속성/통계 및 측정 결과 패널: 개체를 눌렀을 때(또는 속성 버튼)만 표시 */}
        {infoOpen && (
          <div style={{ position: 'relative', display: 'flex' }}>
            <PropertyPanel
              model={modelRef.current}
              lastMeasure={lastMeasure}
              lastArea={lastArea}
              selectedEntity={selectedEntity}
              theme={theme}
              onLayerToggle={handleLayerToggle}
            />
            <button
              onClick={handleCloseInfo}
              aria-label="속성창 닫기"
              style={{ position: 'absolute', top: 4, right: 6, width: 24, height: 24, border: 'none', background: 'transparent', color: isLight ? '#57606a' : '#8b949e', fontSize: 14, cursor: 'pointer' }}
            >✕</button>
          </div>
        )}
      </div>

      {/* 3. 하단 AutoCAD 스타일 명령줄 콘솔 */}
      <CommandBar
        logs={logs}
        setMode={setMode}
        onClear={handleClear}
        onLogMessage={addLog}
      />
    </div>
  );
};

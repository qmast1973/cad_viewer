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

export const App: React.FC = () => {
  const modelRef = useRef<CadModel>(new CadModel());
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
    addLog(`도면 파일 열기 시도: ${fileName} (${(file.size / 1024).toFixed(1)} KB)...`);

    try {
      const buffer = await file.arrayBuffer();
      const isDxfExt = lowerName.endsWith('.dxf');
      const isDwgExt = lowerName.endsWith('.dwg');

      if (!isDxfExt && !isDwgExt) {
        addLog('⚠️ 경고: .dwg 또는 .dxf 확장자 파일만 지원됩니다.');
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
              throw new Error('DWG와 DXF 모두 로드 실패. 올바른 CAD 파일인지 확인하십시오.');
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
      const dxfContent = modelRef.current.exportDxf();
      const blob = new Blob([dxfContent], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cad_drawing_${Date.now()}.dxf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog('✓ DXF 저장 완료. (채움(HATCH)은 채움 없이 경계선으로 저장됩니다)');
    } catch (err: any) {
      addLog(`도면 내보내기 실패: ${err.message || err}`);
    }
  };

  // DWG 내보내기 (실험적: LibreDWG로 생성되어 일부 뷰어에서 열리지 않을 수 있음)
  const handleExportDwg = async () => {
    try {
      addLog('DWG 바이너리 도면 생성 중...');
      const dxfContent = modelRef.current.exportDxf();
      const res = await fetch('/api/export-dwg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dxf: dxfContent })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `서버 오류 (${res.status})`);
      }
      const exportMode = res.headers.get('X-Export-Mode');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cad_drawing_${Date.now()}.dwg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog('✓ DWG 파일 다운로드 완료.');
      if (exportMode === 'rewrite-original') {
        addLog('⚠ 열어 둔 원본 DWG를 다시 쓴 파일이라, 열기 이후의 편집 내용은 반영되지 않았습니다. 편집을 보존하려면 DXF로 저장하세요.');
      }
      addLog('⚠ 이 DWG는 오픈소스 엔진(LibreDWG)으로 만들어져 DWG FastView 등 일부 뷰어에서 열리지 않을 수 있습니다. 열리지 않으면 DXF 저장을 사용하세요.');
    } catch (err: any) {
      console.error('DWG export error:', err);
      addLog(`❌ DWG 내보내기 실패: ${err.message || err}`);
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
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
        onExportDwg={handleExportDwg}
        onClear={handleClear}
        onZoomExtents={triggerZoomExtents}
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
            onSelectEntity={ent => setSelectedEntity(ent)}
            onModelChange={triggerUpdate}
            onLogMessage={addLog}
          />
        </div>

        {/* 우측 속성/통계 및 측정 결과 패널 */}
        <PropertyPanel
          model={modelRef.current}
          lastMeasure={lastMeasure}
          lastArea={lastArea}
          selectedEntity={selectedEntity}
          theme={theme}
          onLayerToggle={handleLayerToggle}
        />
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

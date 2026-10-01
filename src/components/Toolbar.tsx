import React, { useRef } from 'react';
import { CadToolMode } from './CadCanvas.tsx';

interface ToolbarProps {
  mode: CadToolMode;
  setMode: (m: CadToolMode) => void;
  orthoEnabled: boolean;
  setOrthoEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  osnapEnabled: boolean;
  setOsnapEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  textVisible: boolean;
  setTextVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  gridEnabled: boolean;
  setGridEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  theme: 'DARK' | 'LIGHT';
  setTheme: (t: 'DARK' | 'LIGHT' | ((prev: 'DARK' | 'LIGHT') => 'DARK' | 'LIGHT')) => void;
  onOpenFile: (file: File) => void;
  onLoadSample: () => void;
  onExport: () => void;
  onClear: () => void;
  onZoomExtents?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  mode,
  setMode,
  orthoEnabled,
  setOrthoEnabled,
  osnapEnabled,
  setOsnapEnabled,
  textVisible,
  setTextVisible,
  gridEnabled,
  setGridEnabled,
  theme,
  setTheme,
  onOpenFile,
  onLoadSample,
  onExport,
  onClear,
  onZoomExtents,
  onZoomIn,
  onZoomOut
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onOpenFile(files[0]);
    }
  };

  const isLight = theme === 'LIGHT';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 14px',
        backgroundColor: isLight ? '#f6f8fa' : '#202428',
        borderBottom: isLight ? '1px solid #d0d7de' : '1px solid #363b40',
        color: isLight ? '#24292f' : '#e6edf3',
        userSelect: 'none',
        flexWrap: 'wrap',
        gap: '8px'
      }}
    >
      {/* 좌측: 로고 및 파일 관리 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#58a6ff', marginRight: '6px' }}>
          📐 Web CAD Studio
        </div>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".dxf,.dwg"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={btnStyle(isLight)}
          title="DWG 또는 DXF 도면 파일 열기"
        >
          📂 열기 (DWG/DXF)
        </button>

        <button
          onClick={onLoadSample}
          style={btnStyle(isLight)}
          title="표준 샘플 도면 불러오기"
        >
          📄 샘플
        </button>

        <button
          onClick={onExport}
          style={{ ...btnStyle(isLight), backgroundColor: '#238636', borderColor: '#2ea043', color: '#fff' }}
          title="AutoCAD/CADian 호환 표준 DXF로 저장"
        >
          💾 DXF 저장
        </button>

        <button
          onClick={onClear}
          style={{ ...btnStyle(isLight), color: '#f85149' }}
          title="새 도면으로 초기화"
        >
          🗑️ 지우기
        </button>
      </div>

      {/* 중앙: 뷰어 조작 및 정밀 측정 도구 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <button
          onClick={() => setMode('SELECT')}
          style={toolBtnStyle(mode === 'SELECT', isLight)}
          title="선택 도구 (Esc)"
        >
          🖱️ 선택
        </button>

        <button
          onClick={() => setMode('PAN')}
          style={toolBtnStyle(mode === 'PAN', isLight, '#e3b341')}
          title="화면 이동 도구 (마우스 좌클릭 드래그)"
        >
          ✋ 이동 (PAN)
        </button>

        <button
          onClick={() => setMode('DIST')}
          style={toolBtnStyle(mode === 'DIST', isLight, '#3fb950')}
          title="두 점 간 거리 및 치수 측정 (DIST [DI])"
        >
          📐 거리 (DIST)
        </button>

        <button
          onClick={() => setMode('AREA')}
          style={toolBtnStyle(mode === 'AREA', isLight, '#2ea043')}
          title="다각형 면적(m², mm²) 및 둘레 측정 (AREA)"
        >
          🟩 면적 (AREA)
        </button>

        <button
          onClick={() => setMode('LINE')}
          style={toolBtnStyle(mode === 'LINE', isLight)}
          title="선 그리기 (L)"
        >
          📏 선 (LINE)
        </button>

        <button
          onClick={() => setMode('CIRCLE')}
          style={toolBtnStyle(mode === 'CIRCLE', isLight)}
          title="원 그리기 (C)"
        >
          ⭕ 원 (CIRCLE)
        </button>

        <span style={{ width: '1px', height: '18px', backgroundColor: isLight ? '#d0d7de' : '#3f4448', margin: '0 4px' }} />

        {/* 줌 제어 */}
        {onZoomIn && (
          <button onClick={onZoomIn} style={btnStyle(isLight)} title="화면 확대 (+)">
            🔍+
          </button>
        )}
        {onZoomOut && (
          <button onClick={onZoomOut} style={btnStyle(isLight)} title="화면 축소 (-)">
            🔍-
          </button>
        )}
        <button
          onClick={onZoomExtents}
          style={toolBtnStyle(false, isLight, '#a371f7')}
          title="도면 전체 화면에 맞추기 (Zoom Extents [Z+E])"
        >
          🔍 맞춤
        </button>
      </div>

      {/* 우측: 상태 토글 (문자, 직교, 스냅, 그리드, 테마) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          onClick={() => setTextVisible(v => !v)}
          style={{
            ...toggleBtnStyle(textVisible, isLight),
            backgroundColor: textVisible ? '#1f6feb' : (isLight ? '#eaeef2' : '#21262d'),
            borderColor: textVisible ? '#388bfd' : (isLight ? '#d0d7de' : '#30363d'),
            color: textVisible ? '#fff' : (isLight ? '#57606a' : '#8b949e')
          }}
          title="문자/주석 표시 토글 (단축키: T)"
        >
          🔤 문자(T): {textVisible ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setOrthoEnabled(v => !v)}
          style={toggleBtnStyle(orthoEnabled, isLight)}
          title="직교 모드 (F8) - 수평/수직 고정"
        >
          직교(F8): {orthoEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setOsnapEnabled(v => !v)}
          style={toggleBtnStyle(osnapEnabled, isLight)}
          title="객체 스냅 (F3) - 끝점/중심점/교차점 자석 흡착"
        >
          스냅(F3): {osnapEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setGridEnabled(v => !v)}
          style={toggleBtnStyle(gridEnabled, isLight)}
          title="배경 그리드 (F7)"
        >
          격자(F7): {gridEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setTheme(t => t === 'DARK' ? 'LIGHT' : 'DARK')}
          style={{
            ...btnStyle(isLight),
            padding: '4px 8px',
            fontSize: '11px',
            backgroundColor: isLight ? '#eaeef2' : '#2b3137'
          }}
          title="다크 모드 / 화이트 모드 전환"
        >
          {isLight ? '🌙 다크' : '☀️ 화이트'}
        </button>
      </div>
    </div>
  );
};

const btnStyle = (isLight: boolean): React.CSSProperties => ({
  backgroundColor: isLight ? '#ffffff' : '#2b3137',
  color: isLight ? '#24292f' : '#c9d1d9',
  border: isLight ? '1px solid #d0d7de' : '1px solid #3f4448',
  borderRadius: '4px',
  padding: '5px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  transition: 'all 0.15s ease'
});

const toolBtnStyle = (active: boolean, isLight: boolean, activeColor: string = '#58a6ff'): React.CSSProperties => ({
  backgroundColor: active ? (activeColor === '#58a6ff' ? '#1f6feb' : activeColor) : (isLight ? '#ffffff' : '#2b3137'),
  color: active ? '#ffffff' : (isLight ? '#24292f' : '#c9d1d9'),
  border: `1px solid ${active ? activeColor : (isLight ? '#d0d7de' : '#3f4448')}`,
  borderRadius: '4px',
  padding: '5px 10px',
  fontSize: '11px',
  fontWeight: active ? 'bold' : 'normal',
  cursor: 'pointer',
  transition: 'all 0.15s ease'
});

const toggleBtnStyle = (active: boolean, isLight: boolean): React.CSSProperties => ({
  backgroundColor: active ? '#238636' : (isLight ? '#eaeef2' : '#21262d'),
  color: active ? '#ffffff' : (isLight ? '#57606a' : '#8b949e'),
  border: `1px solid ${active ? '#3fb950' : (isLight ? '#d0d7de' : '#30363d')}`,
  borderRadius: '4px',
  padding: '5px 8px',
  fontSize: '11px',
  fontWeight: 'bold',
  cursor: 'pointer'
});

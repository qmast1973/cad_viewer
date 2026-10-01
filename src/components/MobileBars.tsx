import React, { useEffect, useRef, useState } from 'react';
import { CadToolMode } from './CadCanvas.tsx';

// 휴대폰(세로·가로)과 좁은 화면에서는 모바일 화면 구성을 쓴다.
const MOBILE_QUERY = '(max-width: 820px), (max-height: 500px) and (pointer: coarse)';

export function useIsMobile(): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
  const [isMobile, setIsMobile] = useState<boolean>(get);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

const palette = (isLight: boolean) => ({
  bar: isLight ? '#f6f8fa' : '#202428',
  border: isLight ? '#d0d7de' : '#363b40',
  text: isLight ? '#24292f' : '#e6edf3',
  sub: isLight ? '#57606a' : '#8b949e',
  btn: isLight ? '#ffffff' : '#2b3137',
  sheet: isLight ? '#ffffff' : '#1c2128'
});

// ───────────────────────── 상단 바 ─────────────────────────
interface MobileTopBarProps {
  theme: 'DARK' | 'LIGHT';
  menuOpen: boolean;
  infoOpen: boolean;
  onOpenFile: (file: File) => void;
  onExport: () => void;
  onToggleInfo: () => void;
  onToggleMenu: () => void;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  theme, menuOpen, infoOpen, onOpenFile, onExport, onToggleInfo, onToggleMenu
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const c = palette(theme === 'LIGHT');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px',
        paddingTop: 'max(3px, env(safe-area-inset-top))',
        backgroundColor: c.bar, borderBottom: `1px solid ${c.border}`, color: c.text, userSelect: 'none'
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 13, color: '#58a6ff', flex: 1, whiteSpace: 'nowrap' }}>📐 Web CAD</div>
      <input
        type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".dxf,.dwg"
        onChange={e => { const f = e.target.files?.[0]; if (f) onOpenFile(f); e.target.value = ''; }}
      />
      <button style={iconBtn(c.btn, c.text, c.border)} onClick={() => fileInputRef.current?.click()} aria-label="도면 열기">📂</button>
      <button style={{ ...iconBtn('#238636', '#fff', '#2ea043') }} onClick={onExport} aria-label="DXF 저장">💾</button>
      <button
        style={iconBtn(infoOpen ? '#1f6feb' : c.btn, infoOpen ? '#fff' : c.text, c.border)}
        onClick={onToggleInfo} aria-label="속성 보기"
      >ℹ️</button>
      <button
        style={iconBtn(menuOpen ? '#1f6feb' : c.btn, menuOpen ? '#fff' : c.text, c.border)}
        onClick={onToggleMenu} aria-label="메뉴"
      >☰</button>
    </div>
  );
};

// ───────────────────────── 메뉴(펼침) ─────────────────────────
interface MobileMenuProps {
  theme: 'DARK' | 'LIGHT';
  textVisible: boolean;
  orthoEnabled: boolean;
  osnapEnabled: boolean;
  gridEnabled: boolean;
  commandVisible: boolean;
  onLoadSample: () => void;
  onClear: () => void;
  onToggleText: () => void;
  onToggleOrtho: () => void;
  onToggleOsnap: () => void;
  onToggleGrid: () => void;
  onToggleTheme: () => void;
  onToggleCommand: () => void;
  onClose: () => void;
}

export const MobileMenu: React.FC<MobileMenuProps> = p => {
  const c = palette(p.theme === 'LIGHT');
  const item = (label: string, on: boolean | null, onClick: () => void, danger = false) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        minHeight: 38, padding: '0 12px', border: 'none', borderBottom: `1px solid ${c.border}`,
        backgroundColor: 'transparent', color: danger ? '#f85149' : c.text, fontSize: 13, textAlign: 'left'
      }}
    >
      <span>{label}</span>
      {on !== null && (
        <span style={{ color: on ? '#3fb950' : c.sub, fontWeight: 'bold', fontSize: 12 }}>{on ? 'ON' : 'OFF'}</span>
      )}
    </button>
  );
  return (
    <>
      {/* 메뉴 밖을 누르면 닫힌다 */}
      <div onClick={p.onClose} style={{ position: 'absolute', inset: 0, zIndex: 19 }} />
      <div
        style={{
          position: 'absolute', top: 0, right: 0, zIndex: 20, width: 'min(280px, 80%)', maxHeight: '100%', overflowY: 'auto',
          backgroundColor: c.sheet, border: `1px solid ${c.border}`, borderTop: 'none', boxShadow: '0 6px 18px rgba(0,0,0,0.35)'
        }}
      >
        {item('📄 샘플 도면 불러오기', null, () => { p.onLoadSample(); p.onClose(); })}
        {item('🗑️ 도면 지우기', null, () => { p.onClear(); p.onClose(); }, true)}
        {item('🔤 문자 표시', p.textVisible, p.onToggleText)}
        {item('직교 (수평/수직 고정)', p.orthoEnabled, p.onToggleOrtho)}
        {item('객체 스냅 (끝점·중심 흡착)', p.osnapEnabled, p.onToggleOsnap)}
        {item('격자', p.gridEnabled, p.onToggleGrid)}
        {item(p.theme === 'LIGHT' ? '🌙 어두운 화면으로' : '☀️ 밝은 화면으로', null, p.onToggleTheme)}
        {item('⌨️ 명령창 보기', p.commandVisible, p.onToggleCommand)}
      </div>
    </>
  );
};

// ───────────────────────── 하단 도구 바 ─────────────────────────
interface MobileToolBarProps {
  theme: 'DARK' | 'LIGHT';
  mode: CadToolMode;
  setMode: (m: CadToolMode) => void;
}

const TOOLS: { mode: CadToolMode; icon: string; label: string; color?: string }[] = [
  { mode: 'SELECT', icon: '👆', label: '선택' },
  { mode: 'PAN', icon: '✋', label: '이동', color: '#e3b341' },
  { mode: 'MOVE', icon: '✥', label: '개체이동' },
  { mode: 'DIST', icon: '📐', label: '거리', color: '#3fb950' },
  { mode: 'AREA', icon: '🟩', label: '면적', color: '#2ea043' },
  { mode: 'LINE', icon: '📏', label: '선' },
  { mode: 'CIRCLE', icon: '⭕', label: '원' }
];

export const MobileToolBar: React.FC<MobileToolBarProps> = ({ theme, mode, setMode }) => {
  const c = palette(theme === 'LIGHT');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 1, padding: '2px 2px',
        paddingBottom: 'max(2px, env(safe-area-inset-bottom))',
        backgroundColor: c.bar, borderTop: `1px solid ${c.border}`, userSelect: 'none'
      }}
    >
      {TOOLS.map(t => {
        const active = mode === t.mode;
        return (
          <button
            key={t.mode}
            onClick={() => setMode(t.mode)}
            style={{
              flex: '1 1 0', minWidth: 0, height: 40, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 1, padding: 0, border: 'none', borderRadius: 6,
              backgroundColor: active ? (t.color || '#1f6feb') : 'transparent', color: active ? '#fff' : c.text, fontSize: 9
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};

// 도면 위 오른쪽에 떠 있는 보조 버튼: 전체 맞춤, 실행 취소, 다시 실행, 선택 개체 삭제
interface MobileActionStackProps {
  theme: 'DARK' | 'LIGHT';
  onZoomExtents: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
}

export const MobileActionStack: React.FC<MobileActionStackProps> = ({ theme, onZoomExtents, onUndo, onRedo, onDelete }) => {
  const c = palette(theme === 'LIGHT');
  const btn = (icon: string, label: string, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      aria-label={label}
      style={{
        width: 34, height: 34, borderRadius: 17, fontSize: 15, border: `1px solid ${c.border}`,
        backgroundColor: theme === 'LIGHT' ? 'rgba(255,255,255,0.92)' : 'rgba(32,36,40,0.88)', color: c.text,
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
      }}
    >{icon}</button>
  );
  return (
    <div style={{ position: 'absolute', right: 8, top: 36, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {btn('🔍', '전체 맞춤', onZoomExtents)}
      {btn('↩️', '실행 취소', onUndo)}
      {btn('↪️', '다시 실행', onRedo)}
      {btn('🗑️', '선택 삭제', onDelete)}
    </div>
  );
};

const iconBtn = (bg: string, color: string, border: string): React.CSSProperties => ({
  width: 36, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 15, backgroundColor: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer'
});

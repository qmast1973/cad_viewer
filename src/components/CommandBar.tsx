import React, { useState, useRef, useEffect } from 'react';
import { CadToolMode } from './CadCanvas.tsx';

interface CommandBarProps {
  logs: string[];
  setMode: (m: CadToolMode) => void;
  onClear: () => void;
  onLogMessage: (msg: string) => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  logs,
  setMode,
  onClear,
  onLogMessage
}) => {
  const [inputVal, setInputVal] = useState('');
  const [fontSize, setFontSize] = useState<number>(15);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const increaseFontSize = () => setFontSize(s => Math.min(26, s + 2));
  const decreaseFontSize = () => setFontSize(s => Math.max(11, s - 2));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cmd = inputVal.trim().toUpperCase();
      setInputVal('');
      if (!cmd) return;

      onLogMessage(`명령: ${cmd}`);

      if (cmd === 'L' || cmd === 'LINE') {
        setMode('LINE');
      } else if (cmd === 'C' || cmd === 'CIRCLE') {
        setMode('CIRCLE');
      } else if (cmd === 'DI' || cmd === 'DIST' || cmd === 'DISTANCE') {
        setMode('DIST');
      } else if (cmd === 'AA' || cmd === 'AREA') {
        setMode('AREA');
      } else if (cmd === 'P' || cmd === 'PAN') {
        setMode('PAN');
      } else if (cmd === 'ESC' || cmd === 'CANCEL') {
        setMode('SELECT');
      } else if (cmd === 'CLEAR' || cmd === 'CLS') {
        onClear();
      } else if (cmd === 'HELP' || cmd === '?') {
        onLogMessage('지원 명령어: LINE(L), CIRCLE(C), DIST(DI), AREA(AA), PAN(P), ESC, CLEAR');
      } else {
        onLogMessage(`알 수 없는 명령 "${cmd}". 'HELP'를 입력하여 명령어 목록을 확인하십시오.`);
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '140px',
        backgroundColor: '#161b22',
        borderTop: '1px solid #30363d',
        fontFamily: 'Consolas, Monaco, monospace',
        fontSize: `${fontSize}px`,
        color: '#c9d1d9'
      }}
    >
      {/* 터미널 상단 미니 헤더 및 글자 크기 조절 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 10px',
          backgroundColor: '#0d1117',
          borderBottom: '1px solid #21262d',
          fontSize: '11px',
          color: '#8b949e'
        }}
      >
        <span>💻 AutoCAD Command Terminal</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>글자 크기:</span>
          <button
            onClick={decreaseFontSize}
            style={fontBtnStyle}
            title="글자 축소"
          >
            A -
          </button>
          <span style={{ color: '#58a6ff', fontWeight: 'bold', minWidth: '32px', textAlign: 'center' }}>
            {fontSize}px
          </span>
          <button
            onClick={increaseFontSize}
            style={fontBtnStyle}
            title="글자 확대"
          >
            A +
          </button>
        </div>
      </div>

      {/* 로그 히스토리 영역 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}
      >
        {logs.map((log, idx) => (
          <div
            key={idx}
            style={{
              color: log.startsWith('[DIST')
                ? '#56d364'
                : log.startsWith('명령:')
                ? '#79c0ff'
                : '#8b949e'
            }}
          >
            {log}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* 명령어 입력창 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          backgroundColor: '#0d1117',
          borderTop: '1px solid #21262d'
        }}
      >
        <span style={{ color: '#58a6ff', fontWeight: 'bold', marginRight: '8px', fontSize: `${fontSize}px` }}>
          명령:
        </span>
        <input
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="명령 입력 (예: L, C, DI, HELP)"
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#f0f6fc',
            fontFamily: 'inherit',
            fontSize: `${fontSize}px`
          }}
        />
      </div>
    </div>
  );
};

const fontBtnStyle: React.CSSProperties = {
  backgroundColor: '#21262d',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: '3px',
  padding: '1px 6px',
  fontSize: '10px',
  cursor: 'pointer'
};

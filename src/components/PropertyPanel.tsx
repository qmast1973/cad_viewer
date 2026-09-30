import React from 'react';
import {
  CadModel,
  CadEntity,
  MeasureResult,
  AreaResult
} from '../core/cad-model.ts';

interface PropertyPanelProps {
  model: CadModel;
  lastMeasure: MeasureResult | null;
  lastArea: AreaResult | null;
  selectedEntity: CadEntity | null;
  theme?: 'DARK' | 'LIGHT';
  onLayerToggle: (name: string) => void;
}

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  model,
  lastMeasure,
  lastArea,
  selectedEntity,
  theme = 'DARK',
  onLayerToggle
}) => {
  const entities = model.getEntities();
  const layers = model.getLayers();
  const lineCount = entities.filter(e => e.type === 'LINE').length;
  const circleCount = entities.filter(e => e.type === 'CIRCLE').length;
  const textCount = entities.filter(e => e.type === 'TEXT').length;
  const pointCount = entities.filter(e => e.type === 'POINT').length;
  const hatchCount = entities.filter(e => e.type === 'HATCH').length;

  const isLight = theme === 'LIGHT';

  return (
    <div
      style={{
        width: '300px',
        backgroundColor: isLight ? '#f6f8fa' : '#1c2128',
        borderLeft: isLight ? '1px solid #d0d7de' : '1px solid #30363d',
        display: 'flex',
        flexDirection: 'column',
        color: isLight ? '#24292f' : '#c9d1d9',
        fontSize: '12px',
        overflowY: 'auto'
      }}
    >
      {/* 1. 선택된 객체 속성 인스펙터 (AutoCAD Properties 스타일) */}
      <div style={sectionStyle(isLight)}>
        <div style={{ ...titleStyle(isLight), color: '#58a6ff' }}>🔍 객체 속성 (PROPERTIES)</div>
        {selectedEntity ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={rowStyle}>
              <span>객체 유형:</span>
              <span style={{ ...valStyle(isLight), fontWeight: 'bold' }}>{selectedEntity.type}</span>
            </div>
            <div style={rowStyle}>
              <span>소속 레이어:</span>
              <span style={valStyle(isLight)}>{selectedEntity.layer}</span>
            </div>
            {selectedEntity.type === 'LINE' && (
              <>
                <div style={rowStyle}>
                  <span>선분 길이:</span>
                  <span style={{ ...valStyle(isLight), color: '#56d364', fontWeight: 'bold' }}>
                    {Math.hypot(selectedEntity.end.x - selectedEntity.start.x, selectedEntity.end.y - selectedEntity.start.y).toFixed(3)} mm
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                  시작: ({selectedEntity.start.x.toFixed(1)}, {selectedEntity.start.y.toFixed(1)})<br />
                  끝점: ({selectedEntity.end.x.toFixed(1)}, {selectedEntity.end.y.toFixed(1)})
                </div>
              </>
            )}
            {selectedEntity.type === 'CIRCLE' && (
              <>
                <div style={rowStyle}>
                  <span>반지름 (R):</span>
                  <span style={{ ...valStyle(isLight), color: '#56d364', fontWeight: 'bold' }}>
                    {selectedEntity.radius.toFixed(3)} mm
                  </span>
                </div>
                <div style={rowStyle}>
                  <span>지름 (Ø):</span>
                  <span style={valStyle(isLight)}>{(selectedEntity.radius * 2).toFixed(3)} mm</span>
                </div>
                <div style={rowStyle}>
                  <span>원 면적:</span>
                  <span style={valStyle(isLight)}>
                    {(Math.PI * selectedEntity.radius ** 2).toFixed(2)} mm²
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                  중심: ({selectedEntity.center.x.toFixed(1)}, {selectedEntity.center.y.toFixed(1)})
                </div>
              </>
            )}
            {selectedEntity.type === 'TEXT' && (
              <>
                <div style={rowStyle}>
                  <span>문자 내용:</span>
                  <span style={{ ...valStyle(isLight), color: '#ffe873' }}>{selectedEntity.text}</span>
                </div>
                <div style={rowStyle}>
                  <span>문자 높이:</span>
                  <span style={valStyle(isLight)}>{selectedEntity.height} mm</span>
                </div>
              </>
            )}
            {selectedEntity.type === 'HATCH' && (
              <>
                <div style={rowStyle}>
                  <span>채움 방식:</span>
                  <span style={valStyle(isLight)}>{selectedEntity.solid ? 'SOLID (단색)' : '윤곽선'}</span>
                </div>
                <div style={rowStyle}>
                  <span>경계 루프:</span>
                  <span style={valStyle(isLight)}>
                    {selectedEntity.loops.length}개 (점 {selectedEntity.loops.reduce((n, l) => n + l.length, 0)}개)
                  </span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '11px' }}>
            도면 상의 객체를 클릭하면 상세 속성(길이, 반지름, 좌표)이 표시됩니다.
          </div>
        )}
      </div>

      {/* 2. 도면 통계 현황 */}
      <div style={sectionStyle(isLight)}>
        <div style={titleStyle(isLight)}>📊 도면 구성 현황</div>
        <div style={rowStyle}>
          <span>총 엔티티:</span>
          <span style={valStyle(isLight)}>{entities.length}개</span>
        </div>
        <div style={rowStyle}>
          <span>선분 (LINE):</span>
          <span style={valStyle(isLight)}>{lineCount}개</span>
        </div>
        <div style={rowStyle}>
          <span>원 (CIRCLE):</span>
          <span style={valStyle(isLight)}>{circleCount}개</span>
        </div>
        {textCount > 0 && (
          <div style={rowStyle}>
            <span>문자 (TEXT):</span>
            <span style={{ ...valStyle(isLight), color: '#ffe873' }}>{textCount}개</span>
          </div>
        )}
        {hatchCount > 0 && (
          <div style={rowStyle}>
            <span>채움 (HATCH):</span>
            <span style={valStyle(isLight)}>{hatchCount}개</span>
          </div>
        )}
        {pointCount > 0 && (
          <div style={rowStyle}>
            <span>점 (POINT):</span>
            <span style={valStyle(isLight)}>{pointCount}개</span>
          </div>
        )}
      </div>

      {/* 3. 수치 측정 결과 (DIST) */}
      <div style={sectionStyle(isLight)}>
        <div style={{ ...titleStyle(isLight), color: '#56d364' }}>📐 거리 측정 (DIST)</div>
        {lastMeasure ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={rowStyle}>
              <span>실제 거리:</span>
              <span style={{ ...valStyle(isLight), color: '#56d364', fontWeight: 'bold' }}>
                {lastMeasure.distance} mm
              </span>
            </div>
            <div style={rowStyle}>
              <span>X축 증분 (ΔX):</span>
              <span style={valStyle(isLight)}>{lastMeasure.deltaX} mm</span>
            </div>
            <div style={rowStyle}>
              <span>Y축 증분 (ΔY):</span>
              <span style={valStyle(isLight)}>{lastMeasure.deltaY} mm</span>
            </div>
            <div style={rowStyle}>
              <span>경사각:</span>
              <span style={valStyle(isLight)}>{lastMeasure.angleDeg}°</span>
            </div>
          </div>
        ) : (
          <div style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '11px' }}>
            '거리 (DIST)' 도구로 두 점을 클릭하여 측정하십시오.
          </div>
        )}
      </div>

      {/* 4. 면적 및 둘레 측정 결과 (AREA) */}
      <div style={sectionStyle(isLight)}>
        <div style={{ ...titleStyle(isLight), color: '#2ea043' }}>🟩 면적 측정 (AREA)</div>
        {lastArea ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={rowStyle}>
              <span>실제 면적 (m²):</span>
              <span style={{ ...valStyle(isLight), color: '#2ea043', fontWeight: 'bold' }}>
                {lastArea.areaM2} m²
              </span>
            </div>
            <div style={rowStyle}>
              <span>도면 면적 (mm²):</span>
              <span style={valStyle(isLight)}>{lastArea.areaMm2.toLocaleString()} mm²</span>
            </div>
            <div style={rowStyle}>
              <span>외곽 둘레:</span>
              <span style={valStyle(isLight)}>{lastArea.perimeterMm.toLocaleString()} mm</span>
            </div>
            <div style={{ fontSize: '11px', color: '#8b949e' }}>
              측정 꼭짓점: {lastArea.points.length}개 지점
            </div>
          </div>
        ) : (
          <div style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '11px' }}>
            '면적 (AREA)' 도구로 꼭짓점들을 클릭 후 우클릭으로 측정하십시오.
          </div>
        )}
      </div>

      {/* 5. 도면 레이어 관리 */}
      <div style={{ ...sectionStyle(isLight), borderBottom: 'none' }}>
        <div style={titleStyle(isLight)}>📑 도면 레이어 ({layers.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
          {layers.map(layer => (
            <div
              key={layer.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 6px',
                backgroundColor: isLight ? '#ffffff' : '#22272e',
                borderRadius: '3px',
                border: isLight ? '1px solid #e1e4e8' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '10px',
                    height: '10px',
                    backgroundColor: layer.color,
                    borderRadius: '2px',
                    border: '1px solid #444c56'
                  }}
                />
                <span style={{ fontWeight: layer.name === model.getActiveLayer() ? 'bold' : 'normal' }}>
                  {layer.name}
                </span>
              </div>
              <button
                onClick={() => onLayerToggle(layer.name)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: layer.visible ? '#58a6ff' : '#6e7681',
                  fontSize: '13px'
                }}
                title={layer.visible ? '레이어 숨기기' : '레이어 표시'}
              >
                {layer.visible ? '👁️' : '🙈'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const sectionStyle = (isLight: boolean): React.CSSProperties => ({
  padding: '10px 14px',
  borderBottom: isLight ? '1px solid #d0d7de' : '1px solid #30363d'
});

const titleStyle = (isLight: boolean): React.CSSProperties => ({
  fontWeight: 'bold',
  marginBottom: '6px',
  color: isLight ? '#24292f' : '#e6edf3'
});

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '2px 0'
};

const valStyle = (isLight: boolean): React.CSSProperties => ({
  fontFamily: 'monospace',
  color: isLight ? '#0969da' : '#79c0ff'
});

/**
 * DXF 저장 시 개체별 색 유지
 *
 * dxf-writer는 개체 단위 색을 지원하지 않고 레이어 색(ByLayer)만 쓴다.
 * 그래서 뷰어에서는 흰색인 개체가 저장 후에는 소속 레이어 색(빨강/초록 등)으로 바뀌는 문제가 있었다.
 * 개체를 그린 직후 그 개체의 tags()를 감싸, 레이어 지정(그룹 8) 바로 뒤에 트루컬러(그룹 420)를 기록한다.
 */

/** #RRGGBB 문자열을 0xRRGGBB 정수로 변환 (형식이 다르면 null) */
export function hexToTrueColor(hex?: string): number | null {
  if (!hex) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? parseInt(m[1], 16) : null;
}

/** 활성 레이어에 지금까지 추가된 개체 수 (draw* 호출 전에 기록해 두는 용도) */
export function shapeCount(d: any): number {
  return d.activeLayer?.shapes?.length ?? 0;
}

/**
 * fromIndex 이후에 추가된 개체들에 트루컬러를 적용한다.
 * 개체 색이 레이어 색과 같으면 ByLayer를 유지하기 위해 아무것도 하지 않는다.
 */
export function applyEntityColor(d: any, fromIndex: number, entityColor?: string, layerColor?: string): void {
  const trueColor = hexToTrueColor(entityColor);
  if (trueColor === null) return;
  if (layerColor && hexToTrueColor(layerColor) === trueColor) return;

  const shapes = d.activeLayer?.shapes;
  if (!Array.isArray(shapes)) return;

  for (let i = fromIndex; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape || shape.__entityColorApplied) continue;
    const original = shape.tags.bind(shape);
    shape.tags = (manager: any) => {
      let written = false;
      // 이 개체의 첫 번째 레이어 지정(그룹 8) 직후에만 색 그룹을 추가
      manager.push = (code: number, value: unknown) => {
        Object.getPrototypeOf(manager).push.call(manager, code, value);
        if (!written && code === 8) {
          written = true;
          Object.getPrototypeOf(manager).push.call(manager, 420, trueColor);
        }
      };
      try {
        original(manager);
      } finally {
        delete manager.push; // 프로토타입의 원래 push로 복원
      }
    };
    shape.__entityColorApplied = true;
  }
}

/**
 * .cadlite - 가벼운 도면 파일
 *
 * 큰 DWG는 변환 서버(로컬 실행)가 있어야 열 수 있고 열 때마다 1분 가까이 걸린다.
 * 한 번 이 형식으로 변환해 두면 서버 없이(GitHub Pages, 휴대폰 포함) 몇 초 만에 열 수 있다.
 *
 * 파일 구조 (전체를 gzip으로 압축해 저장, 열 때는 gzip 여부를 자동 판별):
 *   [ 'CADLITE1' 8바이트 ][ 머리말 길이 uint32 LE ][ 머리말 JSON(UTF-8) ][ 4바이트 정렬 빈칸 ][ 선분 좌표 Float32 묶음들 ]
 * 머리말에는 개체(문자·원·해치 등), 레이어, 선분 묶음의 위치 정보가 들어 있다.
 * 선분 좌표는 개체 객체로 만들지 않고 (레이어, 색)별 Float32 배열로만 보관한다 (대용량 모드와 같은 방식).
 */

export const LITE_MAGIC = 'CADLITE1';
export const LITE_EXTENSION = '.cadlite';

/** 읽기 전용 선분 묶음: positions = [x1,y1,x2,y2,...] (lineOrigin 기준 상대 좌표) */
export interface LiteBatch {
  layer: string;
  color: string;
  count: number;
  positions: Float32Array;
}

export interface LiteHeader {
  version: number;
  source?: string;
  layers: string[];
  layerColors: Record<string, string>;
  /** LINE/CIRCLE/ARC/POLYLINE/TEXT/HATCH/POINT 개체 (뷰어의 개체 형식 그대로) */
  entities: any[];
  lineOrigin: { x: number; y: number };
  /** 표시하지 못한 개체 종류별 개수 (원본 변환 때 기록) */
  skippedEntities?: Record<string, number>;
}

export interface LiteDecoded {
  header: LiteHeader;
  batches: LiteBatch[];
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/** 압축 전 파일 내용을 조각 목록으로 만든다 (큰 배열을 하나로 복사하지 않기 위해 조각 그대로 반환) */
export function encodeLite(header: LiteHeader, batches: LiteBatch[]): Uint8Array[] {
  const meta = {
    ...header,
    batches: batches.map(b => ({ layer: b.layer, color: b.color, count: b.count, byteLength: b.positions.byteLength }))
  };
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const head = new Uint8Array(8 + 4 + json.length + pad4(8 + 4 + json.length));
  head.set(new TextEncoder().encode(LITE_MAGIC), 0);
  new DataView(head.buffer).setUint32(8, json.length, true);
  head.set(json, 12);
  const parts: Uint8Array[] = [head];
  for (const b of batches) {
    parts.push(new Uint8Array(b.positions.buffer, b.positions.byteOffset, b.positions.byteLength));
  }
  return parts;
}

/** gzip(1f 8b)으로 시작하는지 */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** 압축을 푼 파일 내용을 해석한다. buffer의 시작이 4바이트 경계여야 선분 좌표를 복사 없이 쓸 수 있다 */
export function decodeLite(buffer: ArrayBuffer): LiteDecoded {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== LITE_MAGIC) {
    throw new Error('가벼운 도면(.cadlite) 파일이 아닙니다.');
  }
  const headerLen = new DataView(buffer).getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLen)));
  let offset = 12 + headerLen;
  offset += pad4(offset);

  const batches: LiteBatch[] = [];
  for (const m of meta.batches || []) {
    batches.push({
      layer: m.layer,
      color: m.color,
      count: m.count,
      positions: new Float32Array(buffer, offset, m.byteLength / 4)
    });
    offset += m.byteLength;
  }
  delete meta.batches;
  return { header: meta as LiteHeader, batches };
}

/** 가벼운 도면 파일(Blob) 만들기: 브라우저가 gzip 압축을 지원하면 압축한다 */
export async function makeLiteBlob(header: LiteHeader, batches: LiteBatch[]): Promise<Blob> {
  const raw = new Blob(encodeLite(header, batches) as unknown as BlobPart[]);
  if (typeof CompressionStream === 'undefined') return raw;
  return new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** 가벼운 도면 파일(Blob/File) 읽기: gzip이면 풀고, 아니면 그대로 해석 */
export async function readLiteBlob(blob: Blob): Promise<LiteDecoded> {
  const first = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  let buffer: ArrayBuffer;
  if (isGzip(first)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('이 브라우저는 압축 해제를 지원하지 않습니다. 최신 크롬/사파리에서 열어 주세요.');
    }
    buffer = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } else {
    buffer = await blob.arrayBuffer();
  }
  return decodeLite(buffer);
}

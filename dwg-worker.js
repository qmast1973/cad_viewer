// 브라우저 안에서 DWG 를 가벼운 도면(cadlite)으로 바꾸는 작업자(Web Worker). 서버가 필요 없어서 깃허브 페이지·폰에서도 동작한다.
// 변환기는 Rust(acadrust)로 만든 wasm/dwg2lite.wasm (PC 용 dwg2lite.exe 와 같은 코드).
// 받는 메시지: { buf: ArrayBuffer(DWG), name, flat }   보내는 메시지: { ok:true, buf } 또는 { ok:false, error }
function makeImports() {
  // wasm 안의 라이브러리(acadrust)가 가져오기를 요구한다. 변환 중에는 시계만 쓰인다.
  const handler = () => new Proxy({}, { get: (_, name) => {
    if (/now/.test(name)) return () => Date.now();
    if (/throw/.test(name)) return () => { throw new Error('wasm 내부 오류: ' + name); };
    return () => 0;
  } });
  return { __wbindgen_placeholder__: handler(), __wbindgen_externref_xform__: handler() };
}
self.onmessage = async (e) => {
  try {
    const { buf, name, flat } = e.data;
    const res = await fetch(new URL('wasm/dwg2lite.wasm', self.location.href));
    if (!res.ok) throw new Error('변환기(wasm)를 내려받지 못함 (' + res.status + ')');
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), makeImports());
    const x = instance.exports;
    const put = (bytes) => { const p = x.alloc(bytes.length); new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes); return p; };
    const data = new Uint8Array(buf), nm = new TextEncoder().encode(name || 'drawing.dwg');
    const p = put(data), np = put(nm);
    const r = x.convert(p, data.length, np, nm.length, flat ? 1 : 0);
    const dv = new DataView(x.memory.buffer);
    const status = dv.getUint32(r, true), n = dv.getUint32(r + 4, true);
    const out = new Uint8Array(x.memory.buffer, r + 8, n).slice();     // 복사해서 가져온다(작업자를 끝내면 wasm 메모리는 모두 반환됨)
    if (status !== 0) throw new Error(new TextDecoder().decode(out));
    self.postMessage({ ok: true, buf: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || String(err) });
  }
};

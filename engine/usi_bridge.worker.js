// engine/usi_bridge.worker.js

// ★重要：Emscripten は「グローバルの Module」を参照することがあるので
// let ではなく var を使い、self.Module にも置く
var Module = {
  // pthread worker が「本体JS」を確実に importScripts できるように指定（重要）
  mainScriptUrlOrBlob: self.location.origin + "/engine/yaneuraou.k-p.js",

  // wasm/worker の場所解決
  locateFile: (path) => self.location.origin + "/engine/" + path,

  // ★stdout/stderr をメインへ転送（index.html が raw.s を拾う前提）
  print: (s) => postMessage({ type: "stdout", s: String(s) }),
  printErr: (s) => postMessage({ type: "stderr", s: String(s) }),
};

self.Module = Module; // ★これがないと Module.print が効かない構成がある

// ★絶対URLで読み込む（/engine/... でOK）
importScripts(self.location.origin + "/engine/yaneuraou.k-p.js");

// ★Factory を呼ぶ（Promiseのはず）
var enginePromise = self.YaneuraOu_K_P(Module);

enginePromise
  .then(() => postMessage({ type: "ready" }))
  .catch((err) => postMessage({ type: "stderr", s: "init failed: " + (err?.message || err) }));

// メインから {type:"usi", cmd:"isready"} を受け取って渡す
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg && msg.type === "usi") {
    await enginePromise;
    Module.ccall("usi_command", "number", ["string"], [msg.cmd]);
  }
};

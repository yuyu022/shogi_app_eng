// engine/usi_bridge.worker.js

var Module = {
  // ★ここも後述の通り「origin固定」だとサブパスで壊れます
  // いったん後で直すとして、まずは postMessage 化が最重要
  mainScriptUrlOrBlob: self.location.origin + "/engine/yaneuraou.k-p.js",
  locateFile: (path) => self.location.origin + "/engine/" + path,

  print: (s) => postMessage({ type: "stdout", s: String(s) }),
  printErr: (s) => postMessage({ type: "stderr", s: String(s) }),
};
self.Module = Module;

importScripts(self.location.origin + "/engine/yaneuraou.k-p.js");

// Factory
var enginePromise = self.YaneuraOu_K_P(Module);

// ここは任意（index側が "readyok" 待ちなので、type:"ready" は無くてもOK）
enginePromise
  .then(() => postMessage({ type: "stdout", s: "bridge: enginePromise resolved" }))
  .catch((err) => postMessage({ type: "stderr", s: "init failed: " + (err?.message || err) }));

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg && msg.type === "usi") {
    await enginePromise;

    // ★ここが最重要：ccall直叩きではなく、yaneuraou.k-p.js が用意したキューに投げる
    // （busy時の再試行を内部がやってくれる）
    if (typeof Module.postMessage === "function") {
      Module.postMessage(msg.cmd);
    } else {
      // 万一の保険（通常ここには来ないはず）
      Module.ccall("usi_command", "number", ["string"], [msg.cmd]);
    }
  }
};

// engine/usi_bridge.worker.js
let Module = {
  // pthread worker が「本体JS」を確実に importScripts できるように指定（重要）
  mainScriptUrlOrBlob: self.location.origin + "/engine/yaneuraou.k-p.js",

  // wasm/worker の場所解決（必要なら）
  locateFile: (path) => self.location.origin + "/engine/" + path,

  print: (s) => postMessage({ type: "stdout", s }),
  printErr: (s) => postMessage({ type: "stderr", s }),
};

importScripts("/engine/yaneuraou.k-p.js"); // ← まず本体を読み込む

let enginePromise = YaneuraOu_K_P(Module); // これは Promise のはず

enginePromise.then(() => {
  postMessage({ type: "ready" });
});

// メインからUSI文字列を受け取って、ccall で渡す例
onmessage = async (e) => {
  if (e.data?.type === "usi") {
    await enginePromise; // ready待ち
    const cmd = e.data.cmd; // "isready" など
    Module.ccall("usi_command", "number", ["string"], [cmd]);
  }
};

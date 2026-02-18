// engine/engine.worker.js
"use strict";

// yaneuraou.k-p.js を worker 内で読み込む
importScripts("./yaneuraou.k-p.js");

// yaneuraou 側が stdout をどう吐くかはビルドによって違うので
// とにかく「来たら親へ返す」口を作る
function postOut(s) {
  postMessage({ type: "stdout", data: String(s ?? "") });
}
function postErr(s) {
  postMessage({ type: "stderr", data: String(s ?? "") });
}

// Emscripten Module を用意（多くのビルドで効く）
self.Module = self.Module || {};
Module.print = postOut;
Module.printErr = postErr;

// 入力は「文字列1本」で受けて、そのまま標準入力に渡す想定
// ただしビルドによってstdinの渡し方が違うため、ここで「入口だけ」統一する
self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "stdin") {
    // ここはビルドにより差が出る。
    // まずは「Module.ccall('usi_command', ...)」のような関数があれば呼ぶ。
    // 無ければ stdin に積む方式に寄せる。
    const line = String(msg.data || "");

    // よくある: Module._onStdinLine / Module.onStdinLine が存在するパターン
    if (typeof Module.onStdinLine === "function") {
      Module.onStdinLine(line);
      return;
    }
    if (typeof Module._onStdinLine === "function") {
      Module._onStdinLine(line);
      return;
    }

    // 最後の手段: stdin バッファ方式（Emscriptenが読む想定）
    Module.stdinBuffer = (Module.stdinBuffer || "") + line;
    return;
  }
};

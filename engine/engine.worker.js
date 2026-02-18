// engine/engine.worker.js
"use strict";

// エンジンの出力（print/printErr）を親へ送る
function postOut(s) {
  postMessage({ type: "stdout", data: String(s ?? "") + "\n" });
}
function postErr(s) {
  postMessage({ type: "stderr", data: String(s ?? "") + "\n" });
}

// Emscripten Module を先に用意してから読み込む（超重要）
self.Module = self.Module || {};
Module.print = postOut;
Module.printErr = postErr;

// エンジン本体を読み込む（この中で self.YaneuraOu_K_P が定義される）
importScripts("./yaneuraou.k-p.js");

// yaneuraou.k-p.js の仕様：入力は Module.postMessage("usi") の形
self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "stdin") {
    const line = String(msg.data || "");
    // 1行ずつ処理される想定なので、改行で分割して順番に投げる
    line.split(/\r?\n/).forEach((one) => {
      if (!one) return;
      if (typeof Module.postMessage === "function") {
        Module.postMessage(one);
      } else {
        // 念のため（通常ここには来ない）
        postErr("Module.postMessage is not a function");
      }
    });
  }
};

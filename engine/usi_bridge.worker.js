// engine/usi_bridge.worker.js
// やねうら王(KP) WASM を WebWorker 内で起動し、USIコマンドを受け付けるブリッジ

"use strict";

self.addEventListener("error", (e) => {
  self.postMessage({ type: "fatal", where: "error", message: String(e.message || e), stack: e?.error?.stack });
});
self.addEventListener("unhandledrejection", (e) => {
  self.postMessage({ type: "fatal", where: "unhandledrejection", message: String(e.reason || e), stack: e?.reason?.stack });
});

/**
 * この worker 自身（engine/usi_bridge.worker.js）の場所を基準に
 *  - yaneuraou.k-p.js
 *  - yaneuraou.k-p.wasm
 *  - yaneuraou.k-p.worker.js
 * を解決する（サブディレクトリ配信でも壊れない）
 */
const BASE = new URL("./", self.location.href);
const ENGINE_JS_URL = new URL("yaneuraou.k-p.js", BASE).href;

// Emscripten はグローバルの Module を参照することがあるので var を使う
var Module = {
  // pthread worker が「本体JS」を importScripts するために必要（重要）
  mainScriptUrlOrBlob: ENGINE_JS_URL,

  // wasm/worker 等の場所解決（全部 engine/ 配下にある前提）
  locateFile: (path) => new URL(path, BASE).href,

  // stdout/stderr をメインへ転送（index.html 側が raw.s を拾う想定）
  print: (s) => postMessage({ type: "stdout", s: String(s) }),
  printErr: (s) => postMessage({ type: "stderr", s: String(s) }),
};

// 念のため self.Module にも置く（環境によって必要）
self.Module = Module;

// エンジン本体を読み込む（これが self.YaneuraOu_K_P を定義する）
importScripts(ENGINE_JS_URL);

// Factory 呼び出し（Promise）
var enginePromise;
try {
  if (typeof self.YaneuraOu_K_P !== "function") {
    throw new Error("YaneuraOu_K_P factory が見つかりません（yaneuraou.k-p.js の読み込み失敗）");
  }
  enginePromise = self.YaneuraOu_K_P(Module);
} catch (e) {
  // ここで落ちるならパス問題かファイル読み込み失敗
  postMessage({ type: "stderr", s: "init failed (factory call): " + (e?.message || e) });
  throw e;
}

// 起動完了ログ（必須ではない）
enginePromise
  .then(() => postMessage({ type: "stdout", s: "bridge: enginePromise resolved" }))
  .catch((err) => postMessage({ type: "stderr", s: "init failed: " + (err?.message || err) }));

/**
 * メインから {type:"usi", cmd:"..."} を受け取ってエンジンへ渡す
 * 重要：ccall 直叩きではなく Module.postMessage() に投げる（busy時の再試行はエンジン側が持つ）
 */
self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "usi") return;

  try {
    await enginePromise;

    // yaneuraou.k-p.js 内部のキューへ投げる
    if (typeof Module.postMessage === "function") {
      Module.postMessage(String(msg.cmd || ""));
    } else {
      // 保険（通常ここには来ない）
      Module.ccall("usi_command", "number", ["string"], [String(msg.cmd || "")]);
    }
  } catch (err) {
    postMessage({ type: "stderr", s: "bridge error: " + (err?.message || err) });
  }
};

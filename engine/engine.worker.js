// engine/engine.worker.js
"use strict";

function abs(rel) {
  return new URL(rel, self.location.href).toString();
}

function postOut(s) {
  postMessage({ type: "stdout", data: String(s ?? "") + "\n" });
}
function postErr(s) {
  postMessage({ type: "stderr", data: String(s ?? "") + "\n" });
}
function log(s) {
  postMessage({ type: "log", message: String(s ?? "") });
}

// Module を用意（Emscripten に渡す）
let Mod = (self.Module = self.Module || {});

// stdout/stderr を usi_bridge に返す
Mod.print = postOut;
Mod.printErr = postErr;

// ★超重要：pthread worker が importScripts する “本体JS” を明示する
// これが undefined だと yaneuraou.k-p.worker.js 側で createObjectURL(undefined) になって死ぬ
Mod.mainScriptUrlOrBlob = abs("./yaneuraou.k-p.js");

// ★重要：wasm と pthread worker のパス解決
Mod.locateFile = (path, prefix) => abs("./" + path);

// エンジン本体ロード（MODULARIZE なので “関数” が生える）
importScripts("./yaneuraou.k-p.js");

// --- MODULARIZE 起動 ---
let engineModule = null;
let pending = [];
let started = false;

function getInputFn() {
  if (engineModule && typeof engineModule.postMessage === "function") {
    return (line) => engineModule.postMessage(line);
  }
  if (self.Module && typeof self.Module.postMessage === "function") {
    return (line) => self.Module.postMessage(line);
  }
  return null;
}

function flushPending() {
  const fn = getInputFn();
  if (!fn) return false;
  for (const line of pending) fn(line);
  pending = [];
  return true;
}

async function startEngineOnce() {
  if (started) return;
  started = true;

  try {
    if (typeof self.YaneuraOu_K_P !== "function") {
      postErr("YaneuraOu_K_P is not a function (MODULARIZE init failed)");
      return;
    }

    log("starting YaneuraOu_K_P(Module) ...");

    engineModule = await self.YaneuraOu_K_P(Mod);

    log("engineModule resolved");

    engineModule.print = postOut;
    engineModule.printErr = postErr;

    if (!flushPending()) {
      postErr("engine started but input still missing (no postMessage)");
    } else {
      log("engine input ready");
    }
  } catch (e) {
    postErr("engine start failed: " + (e?.message || e));
    if (e?.stack) postErr(e.stack);
  }
}

// usi_bridge からの入力
self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== "stdin") return;

  startEngineOnce();

  const text = String(msg.data || "");
  const lines = text.split(/\r?\n/).filter(Boolean);

  const fn = getInputFn();
  if (fn) {
    for (const one of lines) fn(one);
  } else {
    pending.push(...lines);
    postErr("queued input (engine not ready yet): " + lines.join(" | "));
  }
};

// 起動だけ先に走らせる
startEngineOnce();

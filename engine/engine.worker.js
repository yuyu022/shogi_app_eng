// engine/engine.worker.js
"use strict";

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

// ★重要：wasm と pthread worker のパス解決（同じ engine/ 配下にある前提）
Mod.locateFile = (path, prefix) => {
  // prefix は無視して「この worker から見た相対」で固定
  // （Cloudflare Pages などで prefix が変になりがちなので）
  return "./" + path;
};

// エンジン本体ロード（MODULARIZE なので “関数” が生える）
importScripts("./yaneuraou.k-p.js");

// --- MODULARIZE 起動 ---
let engineModule = null; // 起動後の実体（ここに postMessage が生える）
let pending = [];
let started = false;

function getInputFn() {
  // 起動後は engineModule.postMessage が入口になる
  if (engineModule && typeof engineModule.postMessage === "function") {
    return (line) => engineModule.postMessage(line);
  }
  // 念のため Module に生えるケースも拾う
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

    // ★ここが肝：MODULARIZE を起動
    engineModule = await self.YaneuraOu_K_P(Mod);

    log("engineModule resolved");

    // 念のため stdout/stderr を確実にこちらに向ける
    engineModule.print = postOut;
    engineModule.printErr = postErr;

    // postMessage が生えてるはず
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

  // 最初の入力が来たら起動（start が呼ばれなくても動くように）
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

// もし “起動だけ先に” したい場合の互換（usi_bridge が {type:"start"} を投げてきてもOK）
startEngineOnce();

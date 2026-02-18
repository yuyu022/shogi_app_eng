// engine/engine.worker.js
"use strict";

function postOut(s) {
  postMessage({ type: "stdout", data: String(s ?? "") + "\n" });
}
function postErr(s) {
  postMessage({ type: "stderr", data: String(s ?? "") + "\n" });
}

// Module を先に用意（print/printErr を差し替え）
self.Module = self.Module || {};
Module.print = postOut;
Module.printErr = postErr;

// エンジン本体ロード
importScripts("./yaneuraou.k-p.js");

// --- ここが肝：入力口を「生えるまで待つ」 ---
let pending = [];
let engineReady = false;

function getInputFn() {
  // 1) Module.postMessage（理想）
  if (self.Module && typeof self.Module.postMessage === "function") {
    return (line) => self.Module.postMessage(line);
  }
  // 2) YaneuraOu_K_P が ready を返すなら、それが解決後に Module が整う可能性
  // （直接入力関数があるケースも一応探す）
  if (self.YaneuraOu_K_P && typeof self.YaneuraOu_K_P.postMessage === "function") {
    return (line) => self.YaneuraOu_K_P.postMessage(line);
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

async function waitUntilReady() {
  // yaneuraou.k-p.js は `return YaneuraOu_K_P.ready` しているので、それを待つ
  try {
    if (self.YaneuraOu_K_P && self.YaneuraOu_K_P.ready) {
      await self.YaneuraOu_K_P.ready;
    }
  } catch (e) {
    postErr("engine ready promise rejected: " + (e?.message || e));
  }

  // ready後も postRun タイミングで postMessage が生えるので少し待ちながらリトライ
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    if (flushPending()) {
      engineReady = true;
      postMessage({ type: "log", message: "engine input ready" });
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  postErr("engine input not ready (Module.postMessage missing)");
}

waitUntilReady();

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== "stdin") return;

  const text = String(msg.data || "");
  const lines = text.split(/\r?\n/).filter(Boolean);

  const fn = getInputFn();
  if (fn) {
    for (const one of lines) fn(one);
  } else {
    // まだ準備できてない → キューに溜める
    pending.push(...lines);
    // 念のため状況をstderrへ（親に届く）
    postErr("queued input (engine not ready yet): " + lines.join(" | "));
  }
};

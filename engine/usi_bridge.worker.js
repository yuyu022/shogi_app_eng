// engine/engine.worker.js
"use strict";

function absUrl(rel) {
  return new URL(rel, self.location.href).toString();
}

let engine = null;
let engineReady = false;
let inQ = [];

function log(msg) {
  self.postMessage({ type: "log", message: String(msg) });
}
function sendStdoutLine(line) {
  self.postMessage({ type: "stdout", data: String(line) + "\n" });
}
function sendStderrLine(line) {
  self.postMessage({ type: "stderr", data: String(line) + "\n" });
}

async function boot() {
  try {
    // ★相対ではなく絶対URLでロード
    importScripts(absUrl("./yaneuraou.k-p.js"));

    if (typeof self.YaneuraOu_K_P !== "function") {
      throw new Error("YaneuraOu_K_P is not exposed on self");
    }

    log("starting YaneuraOu_K_P(Module) ...");

    engine = await self.YaneuraOu_K_P();
    log("engineModule resolved");

    if (typeof engine.addMessageListener === "function") {
      engine.addMessageListener((line) => sendStdoutLine(line));
    } else {
      sendStderrLine("engine.addMessageListener is missing");
    }

    engineReady = true;
    log("engine input ready");

    for (const s of inQ) {
      try {
        engine.postMessage(s);
      } catch (e) {
        sendStderrLine("send failed: " + (e?.message || e));
      }
    }
    inQ = [];
  } catch (e) {
    sendStderrLine("boot failed: " + (e?.message || e));
    throw e;
  }
}

function handleStdin(data) {
  const s = String(data ?? "").replace(/\r?\n$/, "");
  if (!s) return;

  if (!engineReady || !engine) {
    inQ.push(s);
    sendStderrLine(`queued input (engine not ready yet): ${s}`);
    return;
  }

  try {
    engine.postMessage(s);
  } catch (e) {
    sendStderrLine("engine input not ready (" + (e?.message || e) + ")");
  }
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "stdin") handleStdin(msg.data);
};

boot();

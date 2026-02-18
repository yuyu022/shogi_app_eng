// engine/usi_bridge.worker.js
"use strict";

// 落ちたら必ず親へ見える形で返す
self.addEventListener("error", (e) => {
  self.postMessage({
    type: "fatal",
    where: "usi_bridge:error",
    message: String(e.message || e),
    stack: e?.error?.stack,
  });
});
self.addEventListener("unhandledrejection", (e) => {
  self.postMessage({
    type: "fatal",
    where: "usi_bridge:unhandledrejection",
    message: String(e.reason || e),
    stack: e?.reason?.stack,
  });
});

let engineWorker = null;
let buf = "";
let phase = "boot"; // boot -> sent_usi -> sent_isready -> ready

function log(msg) {
  self.postMessage({ type: "log", message: String(msg) });
}

function sendToEngine(line) {
  if (!engineWorker) return;
  const s = line.endsWith("\n") ? line : line + "\n";
  engineWorker.postMessage({ type: "stdin", data: s });
  log(">> " + line);
}

function handleLine(lineRaw) {
  const line = lineRaw.replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // USI 状態機械：usi -> usiok -> isready -> readyok
  if (phase === "sent_usi" && line.trim() === "usiok") {
    sendToEngine("isready");
    phase = "sent_isready";
    return;
  }
  if (phase === "sent_isready" && line.trim() === "readyok") {
    phase = "ready";
    self.postMessage({ type: "readyok" });
    return;
  }

  // 他の行も親へ
  self.postMessage({ type: "stdout", line });
}

function onEngineStdout(chunk) {
  buf += String(chunk || "");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    handleLine(line);
  }
}

function startEngine() {
  // ここが肝：pthread用workerではなく、ラッパー engine.worker.js を起動する
  engineWorker = new Worker("./engine.worker.js", { type: "classic" });

  engineWorker.addEventListener("error", (e) => {
    self.postMessage({
      type: "fatal",
      where: "engineWorker:error",
      message: String(e.message || e),
    });
  });

  engineWorker.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === "stdout") onEngineStdout(msg.data);
    else if (msg.type === "stderr")
      self.postMessage({ type: "stderr", data: String(msg.data || "") });
    else if (msg.type === "log")
      self.postMessage({ type: "log", message: String(msg.message || "") });
    else self.postMessage({ type: "engine_raw", data: msg });
  };

  phase = "sent_usi";
  sendToEngine("usi");
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "start") {
    startEngine();
    return;
  }
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
  }
};

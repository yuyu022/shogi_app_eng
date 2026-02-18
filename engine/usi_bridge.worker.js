// engine/usi_bridge.worker.js

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
let phase = "boot";

function absUrl(rel) {
  return new URL(rel, self.location.href).toString();
}
function log(msg) {
  self.postMessage({ type: "log", message: msg });
}

// ★重要：エンジンへは「cmd文字列」だけ送る（unknown command を避ける）
function sendToEngine(line) {
  if (!engineWorker) return;
  const cmd = String(line || "").trim();
  if (!cmd) return;

  // 多くのUSI wasm workerは「文字列1本」で受ける
  engineWorker.postMessage(cmd);

  log(">> " + cmd);
}

function handleLine(lineRaw) {
  const line = String(lineRaw ?? "").replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  if (phase === "sent_usi" && line.trim() === "usiok") {
    self.postMessage({ type: "stdout", line });
    sendToEngine("isready");
    phase = "sent_isready";
    return;
  }
  if (phase === "sent_isready" && line.trim() === "readyok") {
    phase = "ready";
    self.postMessage({ type: "stdout", line });
    self.postMessage({ type: "readyok" });
    return;
  }

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
  // ★ここを worker.js に戻す
  const wurl = absUrl("./yaneuraou.k-p.worker.js");
  log("start engine worker: " + wurl);

  engineWorker = new Worker(wurl, { type: "classic" });

  engineWorker.addEventListener("error", (e) => {
    self.postMessage({
      type: "fatal",
      where: "engineWorker:error",
      message: String(e.message || e),
    });
  });

  engineWorker.onmessage = (e) => {
    const msg = e.data;

    // エンジンからの生出力をまず全部親へ（デバッグ）
    self.postMessage({ type: "engine_raw", data: msg });

    if (typeof msg === "string") {
      onEngineStdout(msg);
      return;
    }

    const m = msg || {};
    // もし {type:"stdout", data:"..."} 形式で来るなら拾う
    if (m.type === "stdout") {
      const out =
        (typeof m.data === "string") ? m.data :
        (typeof m.s === "string") ? m.s :
        (typeof m.line === "string") ? (m.line + "\n") :
        "";
      if (out) onEngineStdout(out);
      return;
    }

    const fallback =
      (typeof m.data === "string") ? m.data :
      (typeof m.s === "string") ? m.s :
      (typeof m.line === "string") ? (m.line + "\n") :
      "";
    if (fallback) onEngineStdout(fallback);
  };

  phase = "sent_usi";
  sendToEngine("usi");

  setTimeout(() => {
    if (phase === "sent_usi") {
      log("retry usi");
      sendToEngine("usi");
    }
  }, 2000);
}

self.onmessage = (e) => {
  const msg = e.data || {};

  if (msg.type === "start") {
    startEngine();
    return;
  }
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
    return;
  }
};

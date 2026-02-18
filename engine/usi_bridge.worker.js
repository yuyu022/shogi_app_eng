// engine/usi_bridge.worker.js

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
let phase = "boot"; // boot -> sent_usi -> wait_readyok -> ready

let readyRetryTimer = null;
let readyRetryCount = 0;

function absUrl(rel) {
  return new URL(rel, self.location.href).toString();
}

function log(msg) {
  self.postMessage({ type: "log", message: msg });
}

function sendToEngine(line) {
  if (!engineWorker) return;
  const s = line.endsWith("\n") ? line : line + "\n";
  engineWorker.postMessage({ type: "stdin", data: s });
  log(">> " + line);
}

function startReadyRetry() {
  stopReadyRetry();
  readyRetryCount = 0;

  // readyok が来ないときの保険：isready を再送
  readyRetryTimer = setInterval(() => {
    if (phase !== "wait_readyok") return;
    readyRetryCount++;
    log(`(retry) isready x${readyRetryCount}`);
    sendToEngine("isready");

    // 無限にやらない（GUI側の timeout より少し短めで止める）
    if (readyRetryCount >= 10) {
      stopReadyRetry();
      log("(retry) give up isready");
    }
  }, 400);
}

function stopReadyRetry() {
  if (readyRetryTimer) {
    clearInterval(readyRetryTimer);
    readyRetryTimer = null;
  }
}

function handleLine(lineRaw) {
  const line = lineRaw.replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // 状態機械：usi -> usiok -> isready -> readyok
  if (phase === "sent_usi" && line.trim() === "usiok") {
    log("got usiok -> send isready");
    sendToEngine("isready");
    phase = "wait_readyok";
    startReadyRetry();
    return;
  }

  if (phase === "wait_readyok" && line.trim() === "readyok") {
    stopReadyRetry();
    phase = "ready";
    log("got readyok -> READY");
    self.postMessage({ type: "readyok" });
    return;
  }

  // 他の行も親に流しておく（必要ならGUI側で読む）
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
  // engine worker を起動（ここは engine/engine.worker.js を呼ぶ）
  const wurl = absUrl("./engine.worker.js");
  engineWorker = new Worker(wurl, { type: "classic" });

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
    else if (msg.type === "stderr") self.postMessage({ type: "stderr", data: String(msg.data || "") });
    else if (msg.type === "log") self.postMessage({ type: "log", message: String(msg.message || "") });
    else if (typeof msg === "string") onEngineStdout(msg);
  };

  phase = "sent_usi";
  stopReadyRetry();
  log("send usi");
  sendToEngine("usi");
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === "start") {
    startEngine();
    return;
  }
  // GUI側からのコマンド（position/go/stop など）を転送
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
  }
};

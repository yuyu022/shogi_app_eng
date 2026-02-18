// engine/usi_bridge.worker.js

// 1) 落ちたら必ず親へ見える形で返す
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

function handleLine(lineRaw) {
  const line = lineRaw.replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // 状態機械：usi -> usiok -> isready -> readyok
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
  // 2) worker パスは絶対URLで。相対パス事故を潰す
  const wurl = absUrl("./yaneuraou.k-p.worker.js");
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

  // 3) 起動したら必ず usi を送る
  phase = "sent_usi";
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

// engine/usi_bridge.worker.js

// 0) 落ちたら必ず親へ返す
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

// 1) エンジンへ送る（★文字列で送る）
function sendToEngine(line) {
  if (!engineWorker) return;

  const cmd = String(line || "");
  if (!cmd) return;

  // ★重要：オブジェクトではなく「文字列」で送る
  engineWorker.postMessage(cmd);

  log(">> " + cmd);
}

// 2) エンジンstdoutを行で処理
function handleLine(lineRaw) {
  const line = String(lineRaw ?? "").replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // 状態機械：usi -> usiok -> isready -> readyok
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

  // その他も親へ
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

// 3) エンジンworker起動
function startEngine() {
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
    const msg = e.data;

    // よくある：エンジンは文字列で返す
    if (typeof msg === "string") {
      onEngineStdout(msg);
      return;
    }

    // もしオブジェクトで返す実装でも拾えるように保険
    const m = msg || {};
    const out =
      (typeof m.data === "string") ? m.data :
      (typeof m.s === "string") ? m.s :
      (typeof m.line === "string") ? (m.line + "\n") :
      "";
    if (out) onEngineStdout(out);
  };

  // 起動したら usi を送る
  phase = "sent_usi";
  sendToEngine("usi");
}

// 4) 親からのメッセージ
self.onmessage = (e) => {
  const msg = e.data || {};

  if (msg.type === "start") {
    startEngine();
    return;
  }

  // index.html からのコマンド： {type:"cmd", line:"position ..."} を想定
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
    return;
  }

  // 念のため：親が文字列で送ってきた場合も通す
  if (typeof msg === "string") {
    sendToEngine(msg);
    return;
  }
};

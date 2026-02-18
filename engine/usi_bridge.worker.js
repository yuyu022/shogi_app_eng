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

// 1) エンジンへ送る（USIとして送る）
// ※ yaneuraou.k-p.js 側がオブジェクト形式を受ける想定
function sendToEngine(line) {
  if (!engineWorker) return;
  const cmd = String(line || "").trim();
  if (!cmd) return;

  // USIコマンドはこの形で送る（多くのUSIブリッジがこの形式）
  engineWorker.postMessage({ type: "usi", cmd });

  log(">> " + cmd);
}

// 2) stdout を行にして処理
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

// 3) ここが重要：起動するworkerを「yaneuraou.k-p.js」にする
function startEngine() {
  // ★変更点：worker.js ではなく js を起動する
  const wurl = absUrl("./yaneuraou.k-p.js");
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

    // 文字列で返すタイプ
    if (typeof msg === "string") {
      onEngineStdout(msg);
      return;
    }

    // オブジェクトで返すタイプ
    const m = msg || {};

    // stdout候補（data / s / line）
    if (m.type === "stdout") {
      const out =
        (typeof m.data === "string") ? m.data :
        (typeof m.s === "string") ? m.s :
        (typeof m.line === "string") ? (m.line + "\n") :
        "";
      if (out) onEngineStdout(out);
      return;
    }

    // stderr
    if (m.type === "stderr") {
      self.postMessage({ type: "stderr", data: String(m.data || m.s || m.line || "") });
      return;
    }

    // ログ
    if (m.type === "log") {
      self.postMessage({ type: "log", message: String(m.message || "") });
      return;
    }

    // それ以外でも文字列っぽいものがあれば拾う
    const fallback =
      (typeof m.data === "string") ? m.data :
      (typeof m.s === "string") ? m.s :
      (typeof m.line === "string") ? (m.line + "\n") :
      "";
    if (fallback) onEngineStdout(fallback);
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

  // index.html からのコマンド
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
    return;
  }

  // 旧形式が来ても動くように保険
  if (msg.type === "usi") {
    sendToEngine(String(msg.cmd || ""));
    return;
  }
};

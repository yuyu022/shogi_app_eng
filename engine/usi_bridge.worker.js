// engine/usi_bridge.worker.js

// ===============================
// 0) 落ちたら必ず親へ見える形で返す
// ===============================
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

// ===============================
// 1) エンジンへ送る（2方式で送る）
// - A: {type:"stdin", data:"...\n"}
// - B: {type:"usi", cmd:"..."}  ※保険
// ===============================
function sendToEngine(line) {
  if (!engineWorker) return;

  const s = line.endsWith("\n") ? line : line + "\n";

  // どっちの形式でも通るように保険で両方送る
  try { engineWorker.postMessage({ type: "stdin", data: s }); } catch (_) {}
  try { engineWorker.postMessage({ type: "usi", cmd: line }); } catch (_) {}

  log(">> " + line);
}

// ===============================
// 2) エンジンstdoutを「行」で処理する
// ===============================
function handleLine(lineRaw) {
  const line = String(lineRaw ?? "").replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // 状態機械：usi -> usiok -> isready -> readyok
  if (phase === "sent_usi" && line.trim() === "usiok") {
    sendToEngine("isready");
    phase = "sent_isready";
    // usiok も親へ流す（デバッグに便利）
    self.postMessage({ type: "stdout", line });
    return;
  }

  if (phase === "sent_isready" && line.trim() === "readyok") {
    phase = "ready";
    // readyok も親へ流す（デバッグに便利）
    self.postMessage({ type: "stdout", line });
    self.postMessage({ type: "readyok" });
    return;
  }

  // 他の行も親へ流しておく（bestmove 等もここに来る）
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

// ===============================
// 3) エンジンworker起動
// ===============================
function startEngine() {
  // 相対パス事故を防ぐため絶対URL化
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

    // (1) 文字列で来る場合
    if (typeof msg === "string") {
      onEngineStdout(msg);
      return;
    }

    // (2) オブジェクトで来る場合
    const m = msg || {};
    const t = m.type;

    if (t === "stdout") {
      // data / s / line どれでも拾う
      const out =
        (typeof m.data === "string") ? m.data :
        (typeof m.s === "string") ? m.s :
        (typeof m.line === "string") ? (m.line + "\n") : // 1行形式なら改行補完
        "";
      onEngineStdout(out);
      return;
    }

    if (t === "stderr") {
      const errText =
        (typeof m.data === "string") ? m.data :
        (typeof m.s === "string") ? m.s :
        (typeof m.line === "string") ? m.line :
        "";
      self.postMessage({ type: "stderr", data: String(errText || "") });
      return;
    }

    if (t === "log") {
      self.postMessage({ type: "log", message: String(m.message || "") });
      return;
    }

    // (3) 型が違うけど中に文字列がありそうな場合の保険
    const fallback =
      (typeof m.data === "string") ? m.data :
      (typeof m.s === "string") ? m.s :
      (typeof m.line === "string") ? (m.line + "\n") :
      "";
    if (fallback) onEngineStdout(fallback);
  };

  // 起動したら必ず usi を送る
  phase = "sent_usi";
  sendToEngine("usi");
}

// ===============================
// 4) 親からのメッセージ
// - {type:"start"} で起動
// - {type:"cmd", line:"position ..."} などを転送
// ===============================
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

  // もし親が旧形式 {type:"usi", cmd:"..."} を送ってきても受ける（保険）
  if (msg.type === "usi") {
    sendToEngine(String(msg.cmd || ""));
    return;
  }
};

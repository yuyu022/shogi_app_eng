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
let startedAt = 0;

function absUrl(rel) {
  return new URL(rel, self.location.href).toString();
}
function log(msg) {
  self.postMessage({ type: "log", message: msg });
}

// 1) エンジンへ送る（★文字列＋オブジェクト両方で送る）
function sendToEngine(line) {
  if (!engineWorker) return;

  const cmd = String(line || "").trim();
  if (!cmd) return;

  // A: 文字列で送る（USIエンジンがこれを期待することが多い）
  try { engineWorker.postMessage(cmd); } catch (_) {}

  // B: オブジェクトで送る（type/cmd を期待する実装もある）
  try { engineWorker.postMessage({ type: "usi", cmd }); } catch (_) {}

  log(">> " + cmd);
}

// 2) 行単位で USI 状態機械
function handleLine(lineRaw) {
  const line = String(lineRaw ?? "").replace(/\r$/, "");
  if (!line) return;

  log("<< " + line);

  // usiok を見たら isready
  if (phase === "sent_usi" && line.trim() === "usiok") {
    self.postMessage({ type: "stdout", line });
    sendToEngine("isready");
    phase = "sent_isready";
    return;
  }

  // readyok を見たら完了
  if (phase === "sent_isready" && line.trim() === "readyok") {
    phase = "ready";
    self.postMessage({ type: "stdout", line });
    self.postMessage({ type: "readyok" });
    return;
  }

  // その他も親へ（bestmove等もここ）
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

// 3) エンジンworker起動（★ yaneuraou.k-p.js を起動）
function startEngine() {
  startedAt = Date.now();

  const wurl = absUrl("./yaneuraou.k-p.js");
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

    // ★ここが見える化ポイント：最初の数秒は「生の受信」をログに出す
    if (Date.now() - startedAt < 5000) {
      try {
        log("engineWorker raw: " + (typeof msg === "string" ? msg : JSON.stringify(msg)));
      } catch (_) {
        log("engineWorker raw: [unstringifiable object]");
      }
    }

    // 文字列で返るタイプ
    if (typeof msg === "string") {
      onEngineStdout(msg);
      return;
    }

    // オブジェクトで返るタイプ
    const m = msg || {};

    // よくあるstdout表現を全部拾う
    if (m.type === "stdout") {
      const out =
        (typeof m.data === "string") ? m.data :
        (typeof m.s === "string") ? m.s :
        (typeof m.line === "string") ? (m.line + "\n") :
        "";
      if (out) onEngineStdout(out);
      return;
    }

    // typeが無いけど文字列っぽい値がある
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

  // ★保険：2秒たっても usiok が来ない場合もう一回送る
  setTimeout(() => {
    if (phase === "sent_usi") {
      log("retry usi");
      sendToEngine("usi");
    }
  }, 2000);
}

// 4) 親からのメッセージ
self.onmessage = (e) => {
  const msg = e.data || {};

  if (msg.type === "start") {
    startEngine();
    return;
  }

  // index.html から {type:"cmd", line:"position ..."} を想定
  if (msg.type === "cmd") {
    sendToEngine(String(msg.line || ""));
    return;
  }

  // 旧形式保険
  if (msg.type === "usi") {
    sendToEngine(String(msg.cmd || ""));
    return;
  }

  // 文字列でも受ける（保険）
  if (typeof msg === "string") {
    sendToEngine(msg);
  }
};

// engine/usi_bridge.worker.js
importScripts("./yaneuraou.k-p.js");

let engine = null;

// エンジンの出力（print）をメインスレッドに返す
function wireOutput(mod) {
  if (typeof mod.addMessageListener === "function") {
    mod.addMessageListener((line) => {
      // line は "usiok" / "readyok" / "bestmove ..." など1行ずつ来る想定
      postMessage(String(line));
    });
  } else if (typeof mod.print === "function") {
    // 念のため（通常は addMessageListener があるはず）
    const orig = mod.print;
    mod.print = (line) => {
      try { postMessage(String(line)); } catch {}
      try { orig(line); } catch {}
    };
  }
}

YaneuraOu_K_P.ready.then((mod) => {
  engine = mod;
  wireOutput(engine);
  // 起動完了通知（任意）
  postMessage("__ENGINE_READY__");
});

// メイン → worker の入力（USIコマンド文字列）
self.onmessage = (e) => {
  if (!engine) return;
  const msg = e.data;
  if (typeof msg === "string") {
    engine.postMessage(msg);
  } else if (msg && typeof msg.cmd === "string") {
    // もし今後オブジェクト形式で送りたくなった時用
    engine.postMessage(msg.cmd);
  }
};

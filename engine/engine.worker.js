// engine/engine.worker.js
"use strict";

let engine = null;          // YaneuraOu_K_P Module instance
let engineReady = false;
let inQ = [];               // stdin queue until ready

function log(msg) {
  self.postMessage({ type: "log", message: String(msg) });
}

function sendStdoutLine(line) {
  // usi_bridge 側は data を chunk として受けるので \n 付きで送る
  self.postMessage({ type: "stdout", data: String(line) + "\n" });
}

function sendStderrLine(line) {
  self.postMessage({ type: "stderr", data: String(line) + "\n" });
}

async function boot() {
  try {
    // yaneuraou.k-p.js をこの worker にロード
    // ※パスは engine/ 配下から見た相対でOK（あなたの配置に合わせて調整）
    importScripts("./yaneuraou.k-p.js");

    if (typeof self.YaneuraOu_K_P !== "function") {
      throw new Error("YaneuraOu_K_P is not exposed on self");
    }

    log("starting YaneuraOu_K_P(Module) ...");

    engine = await self.YaneuraOu_K_P(); // ← yaneuraou.k-p.js は Promise を返す
    log("engineModule resolved");

    // ★重要：エンジンの出力をここで拾う（これが無いと usi_bridge が usiok を見れない）
    if (typeof engine.addMessageListener === "function") {
      engine.addMessageListener((line) => {
        // line は "usiok" とか "info ..." とか
        sendStdoutLine(line);
      });
    } else {
      // 保険（ここに来るならビルドが違う）
      sendStderrLine("engine.addMessageListener is missing");
    }

    engineReady = true;
    log("engine input ready");

    // 溜めてた stdin を流す
    for (const s of inQ) {
      try {
        engine.postMessage(s); // ★重要：Module.postMessage ではなく engine.postMessage
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
  // usi_bridge からは "usi\n" みたいに来るので改行は除去して送る
  const s = String(data ?? "").replace(/\r?\n$/, "");
  if (!s) return;

  if (!engineReady || !engine) {
    // 起動前はキュー
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
  if (msg.type === "stdin") {
    handleStdin(msg.data);
  } else {
    // 無視（必要なら追加）
  }
};

// 起動
boot();

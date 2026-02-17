// engine/usi_bridge.worker.js
try {
  // 同じ engine/ 配下に置いている前提
  importScripts("./yaneuraou.k-p.js");
} catch (e) {
  postMessage("__ENGINE_LOAD_FAILED__ " + (e && e.message ? e.message : String(e)));
  throw e;
}

let engine = null;

function wireOutput(mod) {
  if (typeof mod.addMessageListener === "function") {
    mod.addMessageListener((line) => postMessage(String(line)));
  } else if (typeof mod.print === "function") {
    const orig = mod.print;
    mod.print = (line) => {
      try { postMessage(String(line)); } catch {}
      try { orig(line); } catch {}
    };
  }
}

// ★ここがポイント：YaneuraOu_K_P は Promise
if (!self.YaneuraOu_K_P || typeof self.YaneuraOu_K_P.then !== "function") {
  postMessage("__ENGINE_API_MISSING__");
  throw new Error("YaneuraOu_K_P is missing or not a Promise. importScripts path may be wrong.");
}

self.YaneuraOu_K_P.then((mod) => {
  engine = mod;
  wireOutput(engine);
  postMessage("__ENGINE_READY__");
}).catch((e) => {
  postMessage("__ENGINE_INIT_FAILED__ " + (e && e.message ? e.message : String(e)));
  throw e;
});

self.onmessage = (e) => {
  if (!engine) return;
  const msg = e.data;
  if (typeof msg === "string") engine.postMessage(msg);
  else if (msg && typeof msg.cmd === "string") engine.postMessage(msg.cmd);
};

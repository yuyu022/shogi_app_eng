// engine/usi_bridge.worker.js
"use strict";

function absUrl(rel){
  return new URL(rel, self.location.href).toString();
}

let engineWorker = null;
let started = false;
let buf = ""; // stdoutの改行分割用

function log(msg){ self.postMessage({ type:"log", message:String(msg) }); }
function fatal(where, err){
  self.postMessage({
    type: "fatal",
    where,
    message: String(err?.message || err),
    stack: err?.stack || ""
  });
}

function emitStdoutLine(line){
  self.postMessage({ type:"stdout", line });
  // readyok などの検出
  if(line === "readyok"){
    self.postMessage({ type:"readyok" });
  }
}

function startEngine(){
  if(started) return;
  started = true;

  const wurl = absUrl("./engine.worker.js");
  log("start engine worker: " + wurl);

  engineWorker = new Worker(wurl, { type:"classic" });

  engineWorker.onmessage = (ev)=>{
    const msg = ev.data || {};

    if(msg.type === "stdout" && typeof msg.data === "string"){
      // dataは "\n"付きで来る想定
      buf += msg.data;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for(const ln of lines){
        const s = ln.trim();
        if(s) emitStdoutLine(s);
      }
      return;
    }

    if(msg.type === "stderr"){
      self.postMessage({ type:"stderr", data: msg.data });
      return;
    }
    if(msg.type === "log"){
      // engine側のログも流す（見たければ）
      self.postMessage({ type:"engine_log", message: msg.message });
      return;
    }

    // その他
    self.postMessage({ type:"engine_raw", data: msg });
  };

  engineWorker.onerror = (e)=>{
    fatal("engineWorker:error", e);
  };

  // 起動したらUSI初期化を自動で流す
  sendCmd("usi");
  // usiok待ち→isready は本当は待つのが理想だけど、
  // まずは即投げでも多くのUSIエンジンで通る
  sendCmd("isready");
}

function sendCmd(line){
  if(!engineWorker){
    // start前に来たら無視 or キューでもOK
    return;
  }
  engineWorker.postMessage({ type:"stdin", data: String(line) + "\n" });
}

self.onmessage = (e)=>{
  const msg = e.data || {};

  if(msg.type === "start"){
    startEngine();
    return;
  }

  // index.html からのコマンド
  if(msg.type === "cmd"){
    if(!started) startEngine();
    sendCmd(msg.line);
    return;
  }
};

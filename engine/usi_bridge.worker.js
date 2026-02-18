// engine/usi_bridge.worker.js

let engineWorker = null;
let buf = "";
let phase = "boot";

function log(m){ postMessage({type:"log", message:String(m)}) }

function onEngineStdout(chunk){
  buf += String(chunk || "");
  let idx;
  while((idx = buf.indexOf("\n")) >= 0){
    const line = buf.slice(0, idx).replace(/\r$/, "");
    buf = buf.slice(idx + 1);

    log("<< " + line);

    if(phase === "sent_usi" && line.trim() === "usiok"){
      engineWorker.postMessage({type:"stdin", data:"isready\n"});
      phase = "sent_isready";
    }else if(phase === "sent_isready" && line.trim() === "readyok"){
      phase = "ready";
      postMessage({type:"readyok"});
    }

    postMessage({type:"stdout", line});
  }
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if(msg.type === "start"){
    engineWorker = new Worker("./engine.worker.js", {type:"classic"});
    engineWorker.onmessage = (ev) => {
      const m = ev.data || {};
      if(m.type === "stdout") onEngineStdout(m.data);
      else if(m.type === "stderr") postMessage({type:"stderr", data:m.data});
      else postMessage({type:"engine_raw", data:m});
    };
    engineWorker.onerror = (err)=>postMessage({type:"fatal", where:"engineWorker", message:String(err.message||err)});
    phase = "sent_usi";
    engineWorker.postMessage({type:"stdin", data:"usi\n"});
    log(">> usi");
    return;
  }
  if(msg.type === "cmd"){
    engineWorker?.postMessage({type:"stdin", data:String(msg.line||"") + "\n"});
  }
};

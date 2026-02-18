// engine/engine.worker.js
"use strict";

function absUrl(rel) {
  return new URL(rel, self.location.href).toString();
}

let engine = null;
let engineReady = false;
let inQ = [];

function log(msg){ self.postMessage({ type:"log", message:String(msg) }); }
function sendStdout(line){ self.postMessage({ type:"stdout", data:String(line) + "\n" }); }
function sendStderr(line){ self.postMessage({ type:"stderr", data:String(line) + "\n" }); }

async function boot(){
  try{
    importScripts(absUrl("./yaneuraou.k-p.js"));

    if(typeof self.YaneuraOu_K_P !== "function"){
      throw new Error("YaneuraOu_K_P is not exposed on self");
    }

    log("starting YaneuraOu_K_P(Module) ...");

    const mainScriptUrl = absUrl("./yaneuraou.k-p.js");

    engine = await self.YaneuraOu_K_P({
      // pthread 子worker が importScripts する「親スクリプト」を明示
      mainScriptUrlOrBlob: mainScriptUrl,

      // wasm / worker を確実に engine/ 配下から解決
      locateFile: (p) => absUrl("./" + p),
    });

    log("engineModule resolved");

    if(typeof engine.addMessageListener === "function"){
      engine.addMessageListener((line)=> sendStdout(line));
    }else{
      sendStderr("engine.addMessageListener is missing");
    }

    engineReady = true;
    log("engine input ready");

    for(const s of inQ){
      try{ engine.postMessage(s); }catch(e){ sendStderr("send failed: " + (e?.message||e)); }
    }
    inQ = [];
  }catch(e){
    sendStderr("boot failed: " + (e?.message||e));
    throw e;
  }
}

function handleStdin(data){
  const s = String(data ?? "").replace(/\r?\n$/, "");
  if(!s) return;

  if(!engineReady || !engine){
    inQ.push(s);
    sendStderr(`queued input (engine not ready yet): ${s}`);
    return;
  }

  try{
    engine.postMessage(s);
  }catch(e){
    sendStderr("engine input not ready (" + (e?.message||e) + ")");
  }
}

self.onmessage = (e)=>{
  const msg = e.data || {};
  if(msg.type === "stdin") handleStdin(msg.data);
};

boot();

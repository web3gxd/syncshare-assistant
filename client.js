'use strict';
(() => {
  const documentId = crypto.randomUUID();
  let current, capture, timer, saving = Promise.resolve(), lastSnapshot;
  const fields = ['key','report','lastAnswer','status','error','startedAt','skips','events','scroll','collapsed',
    'manualPaused','pauseMillis','delayMin','delayMax','reloadCounts','retries','reloads','page','pageTotal',
    'pageDone','currentQuestion','currentQuestionId','stage','pendingRestore','resumeQuestionId','dialogDismissals'];
  async function send(payload) {
    const reply = await chrome.runtime.sendMessage({...payload,documentId});
    if (reply?.error) throw new Error(reply.error);
    return reply;
  }
  function snapshot(state, overrides = {}) {
    const result = Object.fromEntries(fields.filter(key => state[key] !== undefined).map(key => [key,state[key]]));
    // Do not overwrite a recovery snapshot with the initially empty reloaded form.
    if (state.pendingRestore) lastSnapshot = state.pendingRestore;
    else if (capture) lastSnapshot = capture();
    result.pageSnapshot = overrides.pageSnapshot || lastSnapshot || state.pageSnapshot;
    return JSON.parse(JSON.stringify(result));
  }
  function save(state, overrides = {}) {
    clearTimeout(timer);timer = null;
    const data = snapshot(state,overrides);
    const run = overrides.run ?? (state.status === 'running' && !state.manualPaused && !window.__syncShareStop);
    saving = saving.catch(() => {}).then(() => send({type:'ssa/save',state:data,run}));
    return saving.then(reply => {if(reply?.stale) throw new Error('Состояние принадлежит другой загрузке страницы');});
  }
  globalThis.SyncShareExtension = {
    load:() => send({type:'ssa/load'}), save,
    remember(state) {
      current = state;
      if (!timer) timer = setTimeout(() => {timer=null;save(state).catch(failure);},600);
    },
    bind(state, reader) {current=state;capture=reader;}, failure
  };
  function failure(error) {
    console.error('SyncShare Assistant: сохранение',error);
    if (current) {current.error=error.message;current.manualPaused=true;}
  }
  document.addEventListener('change',event => {
    if (current && event.target.matches?.('.que input[type="radio"],.que input[type="checkbox"]')) save(current).catch(failure);
  },true);
  window.addEventListener('pagehide',() => {if(current) save(current).catch(() => {});});
  chrome.runtime.onMessage.addListener((message,_sender,respond) => {
    if (message?.type === 'ssa/status') {
      respond(current ? {status:current.status,question:current.currentQuestion,answers:current.report.length,error:current.error} : {status:'loading'});
    } else if (message?.type === 'ssa/show-panel') {
      if (current?.collapsed) document.getElementById('syncshare-console-panel')?.shadowRoot?.querySelector('.collapse')?.click();
      respond({ok:!!current});
    }
  });
})();

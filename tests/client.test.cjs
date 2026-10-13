const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let sent=[],timerId=0;const listeners={};
const window={addEventListener(name,fn){listeners[name]=fn;}};
const context={window,document:{addEventListener(){},getElementById(){}},crypto:{randomUUID:()=> 'doc'},
  setTimeout:()=>++timerId,clearTimeout(){},console,
  chrome:{runtime:{async sendMessage(message){sent.push(JSON.parse(JSON.stringify(message)));return message.type==='ssa/load'?{resume:true}:{ok:true};},onMessage:{addListener(){}}}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','client.js'),'utf8'),context);
(async()=>{
  const api=context.SyncShareExtension;
  assert.equal((await api.load()).resume,true);
  const state={status:'running',report:[],manualPaused:false,work:window,delayMin:4,delayMax:6};
  window.circular=window;
  api.bind(state,()=>({page:'0',controls:[{id:'a',checked:true}]}));
  await api.save(state);
  let msg=sent.at(-1);assert.equal(msg.run,true);assert.equal(msg.state.work,undefined);
  assert.equal(msg.state.pageSnapshot.controls[0].checked,true);
  state.pendingRestore={page:'0',controls:[{id:'saved',checked:true}]};
  api.bind(state,()=>({page:'0',controls:[]}));
  await api.save(state);assert.equal(sent.at(-1).state.pageSnapshot.controls[0].id,'saved');
  state.manualPaused=true;await api.save(state);assert.equal(sent.at(-1).run,false);
  state.manualPaused=false;window.__syncShareStop=true;await api.save(state);assert.equal(sent.at(-1).run,false);
  await api.save(state,{run:true,pageSnapshot:{page:'1',controls:[]}});
  assert.equal(sent.at(-1).run,true);assert.equal(sent.at(-1).state.pageSnapshot.page,'1');
  console.log('Клиент: снимки, восстановление, пауза/стоп, запись перед навигацией, исключение DOM из хранения — проверено');
})().catch(error=>{console.error(error);process.exitCode=1;});

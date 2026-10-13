const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const session = {}, local = {};let listener, removed;
function area(data) {return {
  async get(key) {return key === null ? {...data} : {[key]:data[key]};},
  async set(values) {Object.assign(data,JSON.parse(JSON.stringify(values)));},
  async remove(keys) {keys.forEach(key=>delete data[key]);}
};}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),{
  URL,chrome:{storage:{session:area(session),local:area(local)},runtime:{onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removed=fn;}}}}
});
function sender(tab=1,doc='a',attempt=42) {return {url:`https://lms.ranepa.ru/mod/quiz/attempt.php?attempt=${attempt}`,tab:{id:tab},frameId:0,documentId:doc};}
function request(type,from,extra={}) {return new Promise(resolve=>listener({type,...extra},from,resolve));}
(async()=>{
  assert.equal((await request('ssa/load',sender())).state,null);
  await request('ssa/save',sender(),{state:{report:[{question:1}],delayMin:3,delayMax:7,scroll:true},run:true});
  const resumed=await request('ssa/load',sender(1,'b'));
  assert.equal(resumed.resume,true);assert.equal(resumed.state.report.length,1);
  assert.equal((await request('ssa/save',sender(),{state:{report:[]},run:false})).stale,true);
  assert.equal((await request('ssa/load',sender(1,'c'))).state.report.length,1);
  assert.equal((await request('ssa/load',sender(2))).state,null);
  assert.equal((await request('ssa/load',sender(1,'d',43))).state,null);
  assert.equal((await request('ssa/load',sender(2))).settings.delayMax,7);
  assert.ok((await request('ssa/load',{...sender(),url:'https://evil.example/mod/quiz/attempt.php?attempt=42'})).error);
  assert.ok((await request('ssa/load',{...sender(),frameId:1})).error);
  await request('ssa/save',sender(1,'c'),{state:{report:[1]},run:false});
  assert.equal((await request('ssa/load',sender(1,'e'))).resume,false);
  await removed(1);assert.equal(Object.keys(session).filter(key=>key.startsWith('session:1:')).length,0);
  assert.ok(Object.keys(session).some(key=>key.startsWith('session:2:')));
  console.log('Хранилище: продолжение, изоляция вкладок/попыток, старые документы, настройки, остановка, валидация и очистка — проверено');
})().catch(error=>{console.error(error);process.exitCode=1;});

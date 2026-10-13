const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const source = readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
const block = source.match(/\/\/ BEGIN ROUTE HELPERS([\s\S]*?)\/\/ END ROUTE HELPERS/);
assert.ok(block, 'Нужна проверка состояния перехода, включая about:blank');
const classify = runInNewContext(block[1] + '\nclassifyURL', { URL });
const initial = new URL('https://lms.example/mod/quiz/attempt.php?attempt=42&page=2');
assert.equal(classify('about:blank', initial), 'loading');
assert.equal(classify('about:blank#opening', initial), 'loading');
assert.equal(classify('https://lms.example/mod/quiz/attempt.php?attempt=42&page=3', initial), 'attempt');
assert.equal(classify('https://lms.example/mod/quiz/processattempt.php', initial), 'saving');
assert.equal(classify('https://lms.example/mod/quiz/summary.php?attempt=42', initial), 'summary');
assert.equal(classify('https://lms.example/login/index.php', initial), 'login');
assert.equal(classify('https://lms.example/my/', initial), 'outside');
assert.equal(classify('https://lms.example/mod/quiz/attempt.php?attempt=43', initial), 'other-attempt');
assert.equal(classify('https://other.example/mod/quiz/attempt.php?attempt=42', initial), 'outside');
assert.equal(classify('https://lms.example/mod/quiz/summary.php?attempt=43', initial), 'other-attempt');
console.log('10 проверок адресов пройдены.');
const booleanBlock = source.match(/\/\/ BEGIN BOOLEAN POLICY([\s\S]*?)\/\/ END BOOLEAN POLICY/);
assert.ok(booleanBlock, 'Нужна отдельная политика true/false');
const chooseBoolean = runInNewContext(booleanBlock[1] + '\nchooseBooleanRows');
assert.equal(chooseBoolean([{value:true,count:64,red:true},{value:false,count:45,red:true}]).value, true);
assert.equal(chooseBoolean([{value:true,count:64,red:true},{value:false,count:45,red:true}]).fallback, true);
assert.equal(chooseBoolean([{value:true,count:100,red:true},{value:false,count:5,red:false}]).value, false);
assert.equal(chooseBoolean([{value:true,count:10,red:true},{value:false,count:10,red:true}]), null);
assert.equal(chooseBoolean([{value:true,count:10,red:true}]), null, 'Исключение требует полную пару');
assert.equal(chooseBoolean([{value:true,count:8,red:false},{value:true,count:9,red:false}]), null);
const delayBlock = source.match(/\/\/ BEGIN DELAY POLICY([\s\S]*?)\/\/ END DELAY POLICY/);
assert.ok(delayBlock);
const delay = runInNewContext(delayBlock[1]+'\nsampleDelay');
assert.equal(delay(4,6,()=>0),4000);
assert.equal(delay(4,6,()=>1),6000);
assert.equal(delay(4,6,()=>0.5),5000);
assert.equal(delay(6,4,()=>0.5),5000);
assert.equal(delay(NaN,6,()=>0.5),5000);

async function simulate(code, config = {}) {
  let now = 0, selected = [], opens = 0, submits = 0, dismissed = 0, pauseApplied = false, reloads = 0;
  const checkpoints = [];
  let current = 0, readyAt = config.loading ? 600 : 0;
  const records = [], errors = [], notices = [];
  const pages = config.pages || [[{label: 'Верный вариант', count: 9}]];
  function buildDocs() {return pages.map((questions, page) => {
    const menus = [], labels = new Map(), controls = new Map();
    const qs = questions.map((data, index) => {
      const id = `${page}-${index}`;
      if (data.boxes) {
        const inputs = data.boxes.map((box, boxIndex) => {
          const boxId = id + '-' + boxIndex;
          let menu;
          const icon = {getBoundingClientRect: () => ({x:0,y:0,width:16,height:16}),
            dispatchEvent() { menu.visible = true; }};
          const input = {id:boxId,type:'checkbox', checked:!!box.checked,disabled:false,parentElement:{icon},
            getAttribute: () => boxId+'-label',
            click() { this.checked = !this.checked; selected.push({time:now,page,index,boxIndex,value:this.checked}); }};
          labels.set(boxId+'-label', {textContent:box.label});
          controls.set(boxId,input);
          const rows = box.rows.map(option => {
            const badge = {textContent:String(option.count),red:option.red};
            return {querySelector: selector => selector.includes('item-label')
              ? {textContent:String(option.value)} : badge, querySelectorAll: () => [badge]};
          });
          const section = {querySelector: () => ({textContent:'Submissions'}), querySelectorAll: () => rows};
          menu = {visible:false, children:[section], getClientRects: () => menu.visible ? [{}] : []};
          menus.unshift(menu); // Порядок меню намеренно отличается от порядка чекбоксов.
          return input;
        });
        return {id, inputs, querySelector: () => ({textContent:String(page+index+1)}),
          querySelectorAll: () => inputs};
      }
      const input = {id,type:'radio', checked: false, disabled: false,
        getAttribute: () => id+'-label',
        click() { this.checked = true; selected.push({time: now, page, index}); }};
      labels.set(id+'-label', {textContent: data.label + (config.changedLabelAfterReload && reloads ? ' (изменено)' : '')});
      controls.set(id,input);
      const labelNode = {textContent: data.label};
      const badge = {textContent: String(data.count), red: !!data.red};
      const row = {querySelector: selector => selector.includes('item-label') ? labelNode : badge,
        querySelectorAll: () => [badge]};
      const historicalBadge = {textContent:'999',red:false};
      const historicalRow = {querySelector: selector => selector.includes('item-label')
        ? {textContent:'Исторический отсутствующий вариант'} : historicalBadge, querySelectorAll: () => [historicalBadge]};
      const section = {querySelector: () => ({textContent: 'Submissions'}),
        querySelectorAll: () => config.historical ? [historicalRow,row] : [row]};
      const hasNoAnswer = data.noAnswer && reloads < (config.failedReloads ?? 1);
      const menu = {visible:false,textContent:hasNoAnswer?'No answer yet':data.label,
        children:hasNoAnswer?[]:[section],getClientRects:()=>menu.visible?[{}]:[]};
      if (!config.noData) menus.push(menu);
      const icon = {getBoundingClientRect:()=>({x:0,y:0,width:16,height:16}),dispatchEvent:()=>{menu.visible=true;}};
      return {id, querySelector: selector => selector === '.answer' ? {icon} : ({textContent: String(page + index + 1)}),
        querySelectorAll: () => [input]};
    });
    const next = {disabled: false,
      value: page < pages.length - 1 ? 'Следующая страница' : 'Закончить попытку',
      click() { submits++; current++; readyAt = now + 600; }};
    const warningButton = {textContent:'Got it',disabled:false,getClientRects:()=>[{}],click:()=>{dismissed++;}};
    const warningBox = {textContent:'Internal state: trying to solve several quizzes at the same time',
      querySelectorAll:()=>[warningButton]};
    const warningHeading = {textContent:config.otherDialog ? 'Unrelated warning' : 'SyncShare: Critical Error',parentElement:warningBox};
    const matchingQuestions = selector => qs.filter((q,index) => selector.split(',').some(part =>
      part.trim().split(/\s/)[0] === '.que.' + (questions[index].questionType || 'multichoice')));
    const doc = {readyState: 'complete', body: {menus, click: () => menus.forEach(menu => {menu.visible = false;})},
      getElementById: id => controls.get(id) || labels.get(id),
      querySelectorAll: selector => selector === 'h1,h2,h3,h4,h5,h6'
        ? config.dialog && !dismissed ? [warningHeading] : [] : matchingQuestions(selector),
      querySelector: selector => selector.includes('.que:not(.multichoice)') &&
        (config.unsupported || (config.guardSetReload && !selector.includes(':not(.multichoiceset)'))) ? {} :
        selector.startsWith('.que.') ? (selector.endsWith(' .qno') ? matchingQuestions(selector)[0]?.querySelector('.qno') : matchingQuestions(selector)[0]) : ({
        'input[name="thispage"]': {value: String(page)},
        'input[name="nextpage"]': {value: String(page + 1)},
        '#mod_quiz-next-nav': next
      })[selector]};
    return doc;
  });}
  let docs = buildDocs();
  const initial = 'https://lms.example/mod/quiz/attempt.php?attempt=42&page=0';
  const work = {closed: false,
    MouseEvent: class {constructor(type,init){Object.assign(this,init);this.type=type;}},
    getComputedStyle: el => ({backgroundColor: el.red ? 'rgba(255, 221, 227, 0.87)' : 'rgb(225,238,227)',display:el.visible ? 'block':'none'}),
    get document() { return docs[current]; },
    get location() {
      if (config.security && now < 600) {
        const e = new Error('Document unavailable'); e.name = 'SecurityError'; throw e;
      }
      return {reload() {reloads++;docs=buildDocs();readyAt=now+600;},href: config.outside ? 'https://lms.example/my/' : config.summary
        ? 'https://lms.example/mod/quiz/summary.php?attempt=42'
        : now < readyAt ? (submits ? 'https://lms.example/mod/quiz/processattempt.php' : 'about:blank')
        : initial.replace('page=0', 'page=' + current)};
    }};
  const window = {chrome: {dom: {openOrClosedShadowRoot: el => el.icon
    ? {querySelector: () => now < (config.wandDelay || 0) ? null : el.icon} : {querySelectorAll: () => el.menus}}},
    open: () => { opens++; return work; }};
  Object.defineProperties(window, Object.getOwnPropertyDescriptors(work));
  const adapter = {load:async()=>({settings:{},state:config.bootState || null,resume:!!config.bootResume}),remember(){},save:async(state,options)=>{checkpoints.push({run:options?.run,pending:!!state.pendingRestore});}};
  if (config.resume) window.__syncShareController = {
    key: 'https://lms.example:42', work, report: [], lastAnswer: 0
  };
  const math = Object.create(Math); math.random=()=>0.5;
  const context = {SyncShareExtension:adapter,SyncShareAssistantUI:{createPanel(){}}, window, chrome: window.chrome, location: {href: initial}, URL,Math:math,
    Date: {now: () => now},
    setTimeout: (fn, ms) => {
      now += Math.max(1, ms);
      if (config.pauseAt && now >= config.pauseAt && !pauseApplied) {
        window.__syncShareController.manualPaused=true; pauseApplied=true;
      }
      if (pauseApplied && now >= config.pauseAt + 2000) window.__syncShareController.manualPaused=false;
      fn();
    },
    console: {log: (...args) => records.push({args, time: now}),
      info: () => {}, warn: (...args) => notices.push(args),
      error: (...args) => errors.push(args), table: () => {}}};
  await runInNewContext(code.replace('const DRY_RUN = false;', `const DRY_RUN = ${config.live ? 'false' : 'true'};`)
    .replace('startNow = false',config.ready?'startNow = false':'startNow = true'), context);
  const checked = docs[current].querySelectorAll('.que.multichoice,.que.multichoiceset').flatMap(q=>q.querySelectorAll('.answer input'))
    .filter(input=>input.checked).map(input=>input.id);
  return {state: window.__syncShareController, selected, opens, submits, records, errors, notices, dismissed,reloads,checked,checkpoints};
}

(async () => {
  for (const config of [{loading: true}, {security: true}, {resume: true}]) {
    const result = await simulate(source, config);
    assert.equal(result.errors.length, 0);
    assert.equal(result.state.report.length, 1);
    assert.equal(result.selected.length, 0, 'Пробный режим не выбирает ответы');
    if (config.resume) assert.equal(result.opens, 0, 'Продолжение не переоткрывает вкладку');
  }
  const outside = await simulate(source, {outside: true});
  assert.equal(outside.state.status, 'paused');
  assert.match(outside.state.error, /\/my\//);
  assert.equal(outside.selected.length, 0);
  const summary = await simulate(source, {summary: true});
  assert.equal(summary.state.status, 'finished');
  assert.equal(summary.submits, 0);
  const noData = await simulate(source, {noData: true});
  assert.equal(noData.state.status, 'paused');
  assert.equal(noData.notices.length, 2, 'Три попытки чтения перед паузой');
  assert.equal(noData.selected.length, 0);
  const red = await simulate(source, {pages: [[{label: 'Красный вариант', count: 100, red: true}]], live: true});
  assert.equal(red.selected.length, 0, 'Красная заливка запрещает выбор');

  const live = await simulate(source, {live: true, loading: true,
    pages: [[{label: 'Ответ страницы 1', count: 9}], [{label: 'Ответ страницы 2', count: 8}]]});
  assert.equal(live.errors.length, 0);
  assert.equal(live.selected.length, 2);
  assert.equal(live.submits, 1, 'При медленном переходе форма отправляется ровно один раз');
  assert.ok(live.selected[1].time - live.selected[0].time >= 5000);
  assert.equal(live.state.status, 'finished');
  const checkboxData = {boxes:[
    {label:'Пункт 1',rows:[{value:true,count:93,red:false},{value:false,count:16,red:true}]},
    {label:'Пункт 2',rows:[{value:false,count:45,red:true},{value:true,count:64,red:true}]},
    {label:'Пункт 3',checked:true,rows:[{value:false,count:103,red:false},{value:true,count:6,red:true}]},
    {label:'Пункт 4',rows:[{value:true,count:92,red:false},{value:false,count:17,red:true}]}
  ]};
  const boxes = await simulate(source, {live:true,pages:[[checkboxData]]});
  assert.equal(boxes.errors.length, 0);
  assert.equal(boxes.state.report[0].kind, 'checkbox');
  assert.equal(boxes.state.report[0].selected, 3);
  assert.equal(boxes.state.report[0].fallbacks, 1);
  assert.equal(boxes.selected.length, 4, 'Три флажка включены, лишний флажок выключен');
  assert.ok(boxes.selected.some(row => row.boxIndex === 2 && row.value === false));
  const tie = await simulate(source, {live:true,pages:[[{boxes:[{label:'Спорный',rows:[
    {value:true,count:10,red:true},{value:false,count:10,red:true}]}]}]]});
  assert.equal(tie.errors.length, 0);
  assert.equal(tie.selected.length, 0);
  assert.equal(Object.keys(tie.state.skips).length, 1);
  const dryBoxes = await simulate(source, {pages:[[checkboxData]]});
  assert.equal(dryBoxes.selected.length, 0);
  assert.equal(dryBoxes.state.report[0].selected, 3);
  const historical = await simulate(source, {live:true,historical:true});
  assert.equal(historical.errors.length,0);
  assert.equal(historical.selected.length,1);
  assert.equal(historical.state.report[0].submissions,9);
  const dialog = await simulate(source, {dialog:true});
  assert.equal(dialog.errors.length,0);
  assert.equal(dialog.dismissed,1);
  assert.equal(dialog.state.dialogDismissals,1);
  const unrelated = await simulate(source, {dialog:true,otherDialog:true});
  assert.equal(unrelated.dismissed,0,'Другие предупреждения автоматически не подтверждаются');
  const paused = await simulate(source,{live:true,pauseAt:500});
  assert.equal(paused.errors.length,0);
  assert.ok(paused.state.pauseMillis >= 1800);
  assert.ok(paused.selected[0].time >= 2500);
  const ready = await simulate(source,{live:true,ready:true});
  assert.equal(ready.state.status,'ready');
  assert.equal(ready.selected.length,0,'До нажатия Старт ответы не меняются');
  const reload = await simulate(source,{live:true,pages:[[
    {label:'Уже выбранный ответ',count:10},checkboxData,{label:'Ответ после загрузки',count:20,noAnswer:true}
  ]]});
  assert.equal(reload.errors.length,0);
  assert.equal(reload.reloads,1);
  assert.equal(reload.state.reloads,1);
  assert.equal(reload.state.pendingRestore,null);
  assert.equal(reload.state.report.length,3,'В отчёте нет повторных вопросов после восстановления');
  assert.ok(reload.checked.includes('0-0'),'Радиокнопка с первой части страницы восстановлена');
  assert.ok(reload.checked.includes('0-1-0')&&reload.checked.includes('0-1-1')&&reload.checked.includes('0-1-3'));
  assert.ok(!reload.checked.includes('0-1-2'),'Неснятый по умолчанию флажок восстановлен в false');
  const bounded = await simulate(source,{live:true,failedReloads:99,pages:[[{label:'Нет данных',count:10,noAnswer:true}]]});
  assert.equal(bounded.reloads,2);
  assert.equal(bounded.state.status,'paused');
  assert.match(bounded.state.error,/двух перезагрузок/);
  const mismatch = await simulate(source,{live:true,changedLabelAfterReload:true,pages:[[
    {label:'Ответ до сбоя',count:10},{label:'Нет данных',count:20,noAnswer:true}
  ]]});
  assert.equal(mismatch.state.status,'paused');
  assert.equal(mismatch.reloads,1);
  assert.ok(mismatch.state.pendingRestore,'При несовпадении снимок не удаляется');
  assert.match(mismatch.state.error,/изменились варианты/);
  const unsupported = await simulate(source,{live:true,unsupported:true,pages:[[{label:'Нет данных',count:10,noAnswer:true}]]});
  assert.equal(unsupported.reloads,0,'Перезагрузка не должна стирать неподдерживаемые поля');
  assert.match(unsupported.state.error,/неподдерживаемые поля/);
  const delayedWand = await simulate(source,{live:true,wandDelay:7000});
  assert.equal(delayedWand.errors.length,0);
  assert.ok(delayedWand.selected[0].time >= 7000,'Ответ ждёт появления палочки');
  const lateBoxes = await simulate(source,{live:true,wandDelay:7000,pages:[[checkboxData]]});
  assert.equal(lateBoxes.state.report[0].selected,3,'Чекбоксы также ждут палочку');
  const neverWand = await simulate(source,{live:true,wandDelay:1e9});
  assert.equal(neverWand.state.status,'paused');
  assert.equal(neverWand.selected.length,0);
  const missingBoxWand = await simulate(source,{live:true,wandDelay:1e9,pages:[[checkboxData]]});
  assert.equal(missingBoxWand.state.status,'paused','Отсутствие палочки не пропускает чекбокс');
  assert.equal(missingBoxWand.selected.length,0);
  const newDocument = await simulate(source,{live:true,ready:true,bootResume:true,bootState:{
    key:'https://lms.example:42',report:[],lastAnswer:0,currentQuestionId:'0-0',
    pageSnapshot:{page:'0',controls:[{id:'0-0',question:'0-0',type:'radio',checked:true,label:'Верный вариант'}]}
  }});
  assert.equal(newDocument.errors.length,0);
  assert.equal(newDocument.state.status,'finished','Новый документ продолжает без нажатия Старт');
  assert.ok(newDocument.checked.includes('0-0'));
  assert.ok(reload.checkpoints.some(save=>save.run && save.pending),'Запись снимка до reload');
  assert.ok(live.checkpoints.some(save=>save.run),'Запись намерения продолжить до перехода');
  const mixedTypes = await simulate(source,{live:true,pages:[[
    {label:'Обычный вопрос',count:10},
    {...checkboxData,questionType:'multichoiceset'},
    {label:'Последний вопрос',count:20}
  ]]});
  assert.equal(mixedTypes.errors.length,0);
  assert.equal(mixedTypes.state.report.length,3,'multichoiceset нельзя молча исключать из обработки');
  assert.equal(mixedTypes.state.report[1].kind,'checkbox');
  assert.equal(mixedTypes.state.report[1].selected,3);
  assert.equal(mixedTypes.state.pageTotal,3);
  const onlySet = await simulate(source,{live:true,pages:[[{...checkboxData,questionType:'multichoiceset'}]]});
  assert.equal(onlySet.errors.length,0,'Страница только с multichoiceset должна загружаться');
  assert.equal(onlySet.state.report[0].selected,3);
  const reloadSet = await simulate(source,{live:true,guardSetReload:true,pages:[[
    {...checkboxData,questionType:'multichoiceset'},
    {label:'После перезагрузки',count:20,noAnswer:true}
  ]]});
  assert.equal(reloadSet.errors.length,0,'multichoiceset поддерживается при перезагрузке');
  assert.equal(reloadSet.reloads,1);
  assert.equal(reloadSet.state.report.length,2);
  assert.ok(reloadSet.checked.includes('0-0-0') && reloadSet.checked.includes('0-0-1') && reloadSet.checked.includes('0-0-3'));
  assert.ok(!reloadSet.checked.includes('0-0-2'));
  console.log('Проверены: загрузка, восстановление после reload без потери радио/чекбоксов, предел перезагрузок, Старт, пауза, случайная задержка, Got it, исторические варианты, несколько ответов, красная пара и переходы.');
})().catch(error => { console.error(error); process.exitCode = 1; });

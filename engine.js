(async function syncShareRun(startNow = false) {
  const QUESTION_SELECTOR = '.que.multichoice,.que.multichoiceset,.que.truefalse';
  const DRY_RUN = false; // true: проверить текущую страницу без выбора ответов
  if (!window.chrome?.dom?.openOrClosedShadowRoot) {
    throw new Error('Chrome не предоставляет доступ к элементам SyncShare.');
  }
  if (window.__syncShareRunning) throw new Error('Скрипт уже работает.');
  const initialURL = new URL(location.href);
  if (!/\/mod\/quiz\/(?:attempt|summary)\.php$/.test(initialURL.pathname) || !initialURL.searchParams.get('attempt')) {
    throw new Error('Откройте страницу активной попытки теста.');
  }
  // BEGIN ROUTE HELPERS
  function classifyURL(href, initial) {
    if (/^about:blank(?:#.*)?$/.test(href)) return 'loading';
    const url = new URL(href);
    if (url.origin !== initial.origin) return 'outside';
    const attempt = url.searchParams.get('attempt');
    if (attempt && attempt !== initial.searchParams.get('attempt')) return 'other-attempt';
    if (url.pathname === initial.pathname && attempt) return 'attempt';
    if (/\/mod\/quiz\/processattempt\.php$/.test(url.pathname)) return 'saving';
    if (/\/mod\/quiz\/summary\.php$/.test(url.pathname) && attempt) return 'summary';
    if (/\/login\//.test(url.pathname)) return 'login';
    return 'outside';
  }
  // END ROUTE HELPERS
  const {createPanel} = globalThis.SyncShareAssistantUI;
  const key = initialURL.origin + ':' + initialURL.searchParams.get('attempt');
  const adapter = globalThis.SyncShareExtension;
  const previous = window.__syncShareController;
  const boot = previous?.key === key ? {state:previous, resume:false} : await adapter.load();
  const work = window;
  const state = previous?.key === key ? previous : Object.assign({key, report:[], lastAnswer:0}, boot.settings, boot.state);
  initialURL.pathname = '/mod/quiz/attempt.php';
  startNow = startNow || !!boot.resume;
  state.work = work;
  window.__syncShareController = state;
  state.status = startNow ? 'running' : 'loading';
  state.dryRun = DRY_RUN;
  state.error = null;
  state.startedAt ||= Date.now();
  state.skips ||= {};
  state.events ||= [];
  state.scroll ??= true;
  state.manualPaused = startNow ? false : !!state.manualPaused;
  state.pauseMillis ||= 0;
  state.delayMin ??= 4;
  state.delayMax ??= 6;
  state.reloadCounts ||= {};
  const actions = {
    start: () => { if (!window.__syncShareRunning) syncShareRun(true); },
    pause: () => { if (state.status !== 'running') return; state.manualPaused = !state.manualPaused; paint(); },
    scroll: () => { state.scroll = !state.scroll; paint(); },
    stop: () => { window.__syncShareStop = true; state.manualPaused = false; paint(); }
  };
  let panel = null;
  let panelDoc = null;
  let paintedAt = 0;
  const paint = () => {
    adapter.remember(state);
    try {
      const doc = work.document;
      if (!doc.body || typeof doc.createElement !== 'function' || doc.readyState === 'loading') return;
      if (panelDoc !== doc || !panel?.host.isConnected) {
        panel?.host.remove();
        panelDoc = doc; panel = createPanel(doc, state, actions);
      }
      if (Date.now() - paintedAt >= 200 || state.status !== 'running') { panel.update(); paintedAt = Date.now(); }
    } catch (error) {
      // Панель не должна мешать переходам или выбору ответа.
      if (!['SecurityError','InvalidStateError'].includes(error.name) && !state.panelWarned) {
        console.warn('Панель временно недоступна:', error.message); state.panelWarned = true;
      }
    }
  };
  const note = message => {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    state.events.push({time:String(Math.floor(elapsed / 60)).padStart(2,'0') + ':' + String(elapsed % 60).padStart(2,'0'), message});
    state.events = state.events.slice(-30); paint();
  };
  const dismissedButtons = new WeakSet();
  const dismissalsPerDoc = new WeakMap();
  const dismissSyncShareWarning = doc => {
    const roots = [doc, shadow(doc.body)].filter(Boolean);
    for (const root of roots) {
      for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        if (text(heading.textContent) !== 'SyncShare: Critical Error') continue;
        for (let box = heading.parentElement, depth = 0; box && depth < 7; box = box.parentElement, depth++) {
          if (!/trying to solve several quizzes/i.test(box.textContent || '')) continue;
          const button = [...box.querySelectorAll('button')].find(el =>
            /^(Got it|Окей|Понятно|OK)$/i.test(text(el.textContent)) && !el.disabled &&
            el.getClientRects().length && !dismissedButtons.has(el));
          if (!button) continue;
          const count = dismissalsPerDoc.get(doc) || 0;
          if (count >= 5) throw new Error('Предупреждение SyncShare повторилось 5 раз. Нужна ручная проверка.');
          dismissedButtons.add(button);
          dismissalsPerDoc.set(doc, count + 1);
          button.click();
          state.dialogDismissals = (state.dialogDismissals || 0) + 1;
          note('Предупреждение SyncShare закрыто (Got it)');
          return true;
        }
      }
    }
    return false;
  };
  const shadow = el => el && chrome.dom.openOrClosedShadowRoot(el);
  const text = value => (value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  // BEGIN SYNC SHARE LOCALE
  function normalizeSyncShareLabel(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase().replace(/ё/g,'е');
  }
  function isStatisticsLabel(value) {
    return ['submissions','statistics','статистика'].includes(normalizeSyncShareLabel(value));
  }
  function parseBooleanLabel(value) {
    const label = normalizeSyncShareLabel(value);
    if (['true','истина','истинно','истинный','верно','правда','да'].includes(label)) return true;
    if (['false','ложь','ложно','ложный','неверно','неправда','нет'].includes(label)) return false;
    return null;
  }
  function isNoAnswersText(value) {
    return /(?:^|\s)(?:no answers? yet|пока нет ответ(?:а|ов)|ответ(?:а|ов) пока нет|еще нет ответ(?:а|ов)|ответ(?:а|ов) еще нет|нет ответ(?:а|ов)(?: пока)?)(?=$|\s|[.!…])/u.test(normalizeSyncShareLabel(value));
  }
  // END SYNC SHARE LOCALE
  const stopped = () => window.__syncShareStop || work.closed;
  window.__syncShareRunning = true;
  window.__syncShareStop = false;
  const pauseGate = async () => {
    while (state.manualPaused && !stopped()) {
      const start = Date.now();
      paint();
      await new Promise(resolve => setTimeout(resolve, 200));
      state.pauseMillis += Date.now() - start;
    }
  };
  const sleep = async ms => {
    const start = Date.now(), pausedAt = state.pauseMillis;
    while (!stopped()) {
      await pauseGate();
      const remaining = ms - (Date.now() - start - (state.pauseMillis - pausedAt));
      if (remaining <= 0) break;
      state.remaining = remaining;
      if (state.countdown) state.stage = 'Следующий ответ через ' + (remaining / 1000).toFixed(1) + ' с';
      paint();
      await new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)));
    }
    paint();
  };

  const waitFor = async (check, timeout = 60000, description = 'ожидание загрузки') => {
    const started = Date.now(), pausedAt = state.pauseMillis;
    let lastError;
    let lastNotice = Date.now();
    while (!stopped()) {
      await pauseGate();
      if (stopped()) return false;
      state.stage = description;
      paint();
      try {
        dismissSyncShareWarning(work.document);
        const result = await check();
        if (result) return result;
      } catch (error) {
        if (!['SecurityError', 'InvalidStateError', 'AbortError'].includes(error.name)) throw error;
        lastError = error;
      }
      if (Date.now() - started - (state.pauseMillis - pausedAt) >= timeout) {
        const error = new Error('Истекло время: ' + description +
          (lastError ? ' (временная недоступность документа)' : ''));
        error.name = 'SyncShareTimeout';
        throw error;
      }
      if (Date.now() - lastNotice >= 10000) {
        console.info('Ожидание:', description);
        lastNotice = Date.now();
      }
      await sleep(250);
    }
    return false;
  };
  const waitForPage = async (afterDoc = null) => {
    let stableDoc;
    let stableSince = 0;
    let lastRoute = 'loading';
    let path = 'about:blank';
    try {
      return await waitFor(() => {
        const href = work.location.href;
        lastRoute = classifyURL(href, initialURL);
        const url = new URL(href);
        path = url.origin === initialURL.origin ? url.pathname : 'другой сайт';
        if (lastRoute === 'other-attempt') throw new Error('Открыта другая попытка теста.');
        const doc = work.document;
        if (!['attempt', 'summary'].includes(lastRoute) || doc.readyState !== 'complete' ||
            (afterDoc && doc === afterDoc)) {
          stableDoc = null;
          return false;
        }
        if (lastRoute === 'attempt' && (!shadow(doc.body) ||
            !doc.querySelector(QUESTION_SELECTOR) || !doc.querySelector('input[name="thispage"]'))) return false;
        if (doc !== stableDoc) { stableDoc = doc; stableSince = Date.now(); }
        return Date.now() - stableSince >= 750 && {doc, finished: lastRoute === 'summary'};
      }, 60000, 'загрузка страницы теста');
    } catch (error) {
      if (error.name !== 'SyncShareTimeout') throw error;
      if (lastRoute === 'login') throw new Error('Войдите в систему, вернитесь к попытке теста и нажмите Старт.');
      throw new Error('Не дождался страницы теста. Текущий путь: ' + path +
        '. После устранения причины нажмите Старт.');
    }
  };
  const isRed = row => [row, ...row.querySelectorAll('.content')].some(el => {
    const rgba = work.getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (!rgba || rgba.length < 3 || (rgba.length === 4 && rgba[3] === 0)) return false;
    const [r, g, b] = rgba;
    return r > 180 && r > g + 12 && r > b + 12;
  });
  // BEGIN ANSWER LABELS
  function answerLabelText(node) {
    if (!node) return '';
    if (typeof node.cloneNode !== 'function') return text(node.textContent);
    const copy = node.cloneNode(true);
    // Буквы a./b. — оформление Moodle, а не часть варианта в SyncShare.
    copy.querySelectorAll('.answernumber,input,.accesshide,.sr-only,.visually-hidden').forEach(el => el.remove());
    return text(copy.textContent);
  }
  function inputLabel(input, doc) {
    const referenced = text((input.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => answerLabelText(doc.getElementById(id))).join(' '));
    if (referenced) return referenced;
    const associated = text([...(input.labels || [])].map(answerLabelText).join(' '));
    if (associated) return associated;
    return text(input.getAttribute('aria-label')) || answerLabelText(doc.getElementById(input.id + '_label'));
  }
  // END ANSWER LABELS
  // BEGIN DELAY POLICY
  function sampleDelay(min, max, random = Math.random) {
    const low = Math.max(0.5, Math.min(30, Math.min(Number(min),Number(max))));
    const high = Math.max(low, Math.min(30, Math.max(Number(min),Number(max))));
    if (!Number.isFinite(low) || !Number.isFinite(high)) return 5000;
    return (low + (high - low) * random()) * 1000;
  }
  // END DELAY POLICY
  const waitBetweenAnswers = async () => {
    const delay = sampleDelay(state.delayMin,state.delayMax);
    state.countdown = true;
    await sleep(Math.max(0,delay - (Date.now() - state.lastAnswer)));
    state.countdown = false;
    state.remaining = 0;
  };
  const visibleNoAnswer = doc => [...(shadow(doc.body)?.querySelectorAll('.syncshare-cm') || [])]
    .some(menu => menu.getClientRects?.().length && isNoAnswersText(menu.textContent));
  const capturePage = doc => ({
    page:doc.querySelector('input[name="thispage"]')?.value,
    controls:[...doc.querySelectorAll(QUESTION_SELECTOR)].flatMap(question =>
      [...question.querySelectorAll('.answer input[type="radio"],.answer input[type="checkbox"]')]
        .filter(input => ['radio','checkbox'].includes(input.type)).map(input => ({
          id:input.id, question:question.id, type:input.type, checked:input.checked,
          label:inputLabel(input,doc)
        })))
  });
  const restorePage = async doc => {
    const snapshot = state.pendingRestore;
    if (!snapshot) return;
    if (doc.querySelector('input[name="thispage"]')?.value !== snapshot.page) {
      throw new Error('После перезагрузки открыта другая страница. Снимок ответов сохранён для проверки.');
    }
    const pairs = snapshot.controls.map(saved => ({saved,input:doc.getElementById(saved.id)}));
    if (JSON.stringify(capturePage(doc).controls.map(input => input.id)) !== JSON.stringify(snapshot.controls.map(input => input.id))) {
      throw new Error('После перезагрузки изменилась структура вопросов. Снимок отметок сохранён для проверки.');
    }
    if (pairs.some(({saved,input}) => !input || input.type !== saved.type || inputLabel(input,doc) !== saved.label)) {
      throw new Error('После перезагрузки изменились варианты. Автовосстановление отменено, снимок ответов сохранён.');
    }
    for (const {saved,input} of pairs) {
      if ((saved.type === 'checkbox' || saved.checked) && input.checked !== saved.checked) {
        if (input.disabled) throw new Error('Не удалось восстановить недоступное поле ответа.');
        input.click();
      }
    }
    const groups = new Map();
    for (const pair of pairs.filter(pair => pair.saved.type === 'radio')) {
      const group = groups.get(pair.saved.question) || [];
      group.push(pair); groups.set(pair.saved.question,group);
    }
    for (const [question,group] of groups) {
      if (!group.some(pair => pair.saved.checked) && group.some(pair => pair.input.checked)) {
        const clear = doc.getElementById(question)?.querySelector('.qtype_multichoice_clearchoice input[type="radio"]');
        if (!clear || clear.disabled) throw new Error('Не удалось восстановить вопрос без выбранного ответа.');
        clear.click();
      }
    }
    await sleep(200);
    if (pairs.some(({saved,input}) => saved.checked !== input.checked)) {
      throw new Error('Проверка восстановления ответов не прошла. Продолжение остановлено.');
    }
    state.pendingRestore = null;
    state.reloadFromDoc = null;
    note('Отметки текущей страницы восстановлены после перезагрузки');
  };
  const requestReload = async (doc, question) => {
    if (work.document !== doc || classifyURL(work.location.href,initialURL) !== 'attempt') {
      throw new Error('Страница изменилась. Перезагрузка отменена.');
    }
    if (doc.querySelector('.que:not(.multichoice):not(.multichoiceset):not(.truefalse) textarea,.que:not(.multichoice):not(.multichoiceset):not(.truefalse) select,.que:not(.multichoice):not(.multichoiceset):not(.truefalse) input:not([type="hidden"])')) {
      throw new Error('На странице есть неподдерживаемые поля. Автоперезагрузка отменена, чтобы не потерять ответы.');
    }
    const snapshot = capturePage(doc);
    if (snapshot.page === undefined || !snapshot.controls.length || snapshot.controls.some(input => !input.id)) {
      throw new Error('Не удалось сохранить отметки. Перезагрузка отменена.');
    }
    const count = state.reloadCounts[snapshot.page] || 0;
    if (count >= 2) throw new Error('No answer yet остаётся после двух перезагрузок. Нужна ручная проверка.');
    state.pendingRestore = snapshot;
    state.reloadFromDoc = doc;
    state.resumeQuestionId = question.id;
    state.reloadCounts[snapshot.page] = count + 1;
    state.reloads = (state.reloads || 0) + 1;
    note('No answer yet: отметки сохранены, перезагрузка ' + (count + 1) + '/2');
    await adapter.save(state, {pageSnapshot:snapshot, run:true});
    work.location.reload();
    const error = new Error('Повтор загрузки страницы SyncShare');
    error.name = 'SyncShareReload';
    throw error;
  };
  // BEGIN BOOLEAN POLICY
  function chooseBooleanRows(rows) {
    const numeric = rows.filter(row => typeof row.value === 'boolean' &&
      Number.isSafeInteger(row.count) && row.count > 0);
    if (new Set(numeric.map(row => row.value)).size !== numeric.length) return null;
    const allowed = numeric.filter(row => !row.red);
    // Исключение пользователя применяется только к полной красной паре true/false.
    const fallback = !allowed.length && numeric.length === 2 && numeric.every(row => row.red);
    const candidates = (fallback ? numeric : allowed).slice().sort((a,b) => b.count - a.count);
    if (!candidates.length || (candidates[1] && candidates[0].count === candidates[1].count)) return null;
    return {...candidates[0], fallback};
  }
  // END BOOLEAN POLICY
  const checkboxes = question => [...question.querySelectorAll('.answer input[type="checkbox"]')]
    .filter(input => input.type === 'checkbox');
  const waitForWand = async (host, doc, question) => {
    try { return await waitFor(async () => {
      if (work.document !== doc) throw new Error('Страница изменилась во время ожидания SyncShare.');
      if (visibleNoAnswer(doc)) await requestReload(doc,question);
      const icon = shadow(host)?.querySelector?.('span.icon');
      if (!icon || (icon.getClientRects && !icon.getClientRects().length)) return false;
      const rect = icon.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && icon;
    },120000,'Ожидание волшебной палочки SyncShare');
    } catch (error) {
      if (error.name === 'SyncShareTimeout') error.name = 'SyncShareWandTimeout';
      throw error;
    }
  };
  const checkboxPlan = async (input, doc, question) => {
    const host = input.parentElement;

    for (let retry = 0; retry < 3 && !stopped(); retry++) {
      try {
        const icon = await waitForWand(host,doc,question);
        if (!icon) return false;
        doc.body.click();
        const rect = icon.getBoundingClientRect();
        icon.dispatchEvent(new work.MouseEvent('click', {
          bubbles:false, composed:false, cancelable:true,
          clientX:rect.x + rect.width / 2, clientY:rect.y + rect.height / 2
        }));
        let signature, since = 0;
        const result = await waitFor(async () => {
          if (visibleNoAnswer(doc)) await requestReload(doc,question);
          if (work.document !== doc) throw new Error('Страница изменилась во время чтения чекбокса.');
          const menus = [...(shadow(doc.body)?.querySelectorAll('.syncshare-cm') || [])]
            .filter(menu => menu.getClientRects().length && work.getComputedStyle(menu).display !== 'none');
          if (menus.length !== 1) return false;
          const section = [...menus[0].children].find(el =>
            isStatisticsLabel(el.querySelector(':scope > .item-label')?.textContent));
          if (!section) return false;
          const rows = [...section.querySelectorAll(':scope > .sub-menu > .menu-item')].map(row => {
            const label = text(row.querySelector(':scope > .item-label')?.textContent).toLowerCase();
            const count = text(row.querySelector(':scope > .postfix > .content')?.textContent).replace(/\s/g,'');
            return {value:parseBooleanLabel(label),
              count:/^\d+$/.test(count) ? Number(count) : NaN, red:isRed(row)};
          });
          if (!rows.length || rows.some(row => row.value === null || !Number.isSafeInteger(row.count))) return false;
          const next = JSON.stringify(rows);
          if (next !== signature) {signature = next; since = Date.now();}
          if (Date.now() - since < 500) return false;
          const best = chooseBooleanRows(rows);
          return best ? {input, label:inputLabel(input,doc), ...best} : {input,skip:'равный максимум или нет допустимых данных'};
        }, 10000, 'статистика пункта: ' + inputLabel(input,doc));
        return result;
      } catch (error) {
        if (error.name !== 'SyncShareTimeout') throw error;
        if (visibleNoAnswer(doc)) await requestReload(doc,question);
        if (retry === 2) return {input, skip:'SyncShare не загрузил статистику пункта'};
        state.retries = (state.retries || 0) + 1;
        note('Повтор чтения чекбокса ' + (retry + 2) + '/3');
        await sleep(1000 * (retry + 1));
      } finally { if (work.document === doc) doc.body.click(); }
    }
    return false;
  };
  const checkboxPlans = async (question, doc) => {
    const plans = [];
    for (const input of checkboxes(question)) {
      if (stopped()) break;
      const plan = await checkboxPlan(input, doc, question);
      if (plan) plans.push(plan);
    }
    return plans;
  };
  const scrollToQuestion = question => {
    if (!state.scroll || typeof question.getBoundingClientRect !== 'function') return;
    const reduced = work.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    work.scrollTo({top:Math.max(0, work.scrollY + question.getBoundingClientRect().top - 100),
      behavior:reduced ? 'auto' : 'smooth'});
  };
  const saveResult = result => {
    const index = state.report.findIndex(row => row.question === result.question);
    if (index < 0) state.report.push(result); else state.report[index] = result;
    delete state.skips[result.question];
    state.pageDone++;
    note('Вопрос ' + result.question + ': ' + (result.kind === 'checkbox' ? result.selected + ' отмечено' : 'вариант выбран'));
    paint();
  };
  const skipQuestion = (number, reason) => {
    state.skips[number] = reason; state.pageDone++;
    console.warn('Пропуск вопроса', number, reason);
    note('Вопрос ' + number + ': ' + reason);
  };
  const processCheckboxes = async (question, doc, number) => {
    let plans = await checkboxPlans(question, doc);
    if (stopped()) return;
    if (!plans.some(plan => !plan.skip)) { skipQuestion(number,'нет данных для чекбоксов'); return; }
    await waitBetweenAnswers();
    if (stopped()) return;
    plans = await checkboxPlans(question, doc);
    if (stopped()) return;
    const known = plans.filter(plan => !plan.skip);
    if (!known.length) { skipQuestion(number,'статистика чекбоксов изменилась'); return; }
    await pauseGate();
    if (stopped()) return;
    if (!DRY_RUN) {
      for (const plan of known) if (plan.input.checked !== plan.value) plan.input.click();
      await sleep(200);
      if (known.some(plan => plan.input.checked !== plan.value)) throw new Error('Не удалось применить чекбоксы: вопрос ' + number);
    }
    const selected = DRY_RUN ? known.filter(plan => plan.value).map(plan => plan.label)
      : checkboxes(question).filter(input => input.checked).map(input => inputLabel(input,doc));
    state.lastAnswer = Date.now();
    const fallbacks = known.filter(plan => plan.fallback).length;
    const result = {question:number, kind:'checkbox', selected:selected.length,
      answer:selected.join('\n') || 'Ничего не отмечено (false)',
      submissions:known.map(plan => plan.count).join(' / '),
      unknown:plans.length - known.length, fallbacks};
    saveResult(result);
    if (fallbacks) note('Вопрос ' + number + ': оба состояния красные у ' + fallbacks + ' пункта; выбран максимум');
    console.log(DRY_RUN ? 'Проверка чекбоксов' : 'Чекбоксы выбраны', result);
  };
  const choices = (question, doc) => {
    const inputs = [...question.querySelectorAll('.answer input[type="radio"]')];
    const options = inputs.map(input => ({input, label:inputLabel(input,doc)}));
    const menus = [...(shadow(doc.body)?.querySelectorAll('.syncshare-cm') || [])];
    const visible = menus.filter(menu => menu.getClientRects?.().length && work.getComputedStyle(menu).display !== 'none');
    const candidates = (visible.length === 1 ? visible : menus).map(menu => {
      const section = [...menu.children].find(el =>
        isStatisticsLabel(el.querySelector(':scope > .item-label')?.textContent));
      return [...(section?.querySelectorAll(':scope > .sub-menu > .menu-item') || [])]
        .map(row => {
          const label = text(row.querySelector(':scope > .item-label')?.textContent);
          const count = text(row.querySelector(':scope > .postfix > .content')?.textContent)
            .replace(/\s/g, '');
          const matches = options.filter(option => option.label === label);
          return {
            label, input: matches.length === 1 ? matches[0].input : null,
            count: /^\d+$/.test(count) ? Number(count) : NaN,
            red: isRed(row)
          };
        });
    }).filter(rows => rows.some(row => row.input)).map(rows => rows.filter(row => row.input));
    // Исторические варианты, которых нет в текущем вопросе, не участвуют в выборе.
    if (candidates.length !== 1) return null;
    return candidates[0].filter(row => !row.red && !row.input.disabled &&
      Number.isSafeInteger(row.count) && row.count > 0).sort((a, b) => b.count - a.count);
  };

  const readChoices = async (question, doc) => {
    for (let attempt = 1; attempt <= 3 && !stopped(); attempt++) {
      try {
        const icon = await waitForWand(question.querySelector('.answer'),doc,question);
        if (!icon) return false;
        doc.body.click();
        if (icon) {
          const rect = icon.getBoundingClientRect();
          icon.dispatchEvent(new work.MouseEvent('click', {bubbles:false,composed:false,cancelable:true,
            clientX:rect.x + rect.width / 2,clientY:rect.y + rect.height / 2}));
        }
        let signature;
        let since = 0;
        const result = await waitFor(async () => {
          if (visibleNoAnswer(doc)) await requestReload(doc,question);
          if (work.document !== doc) throw new Error('Страница изменилась во время выбора. Повторите запуск.');
          const rows = choices(question, doc);
          if (rows === null) { signature = null; return false; }
          const next = JSON.stringify(rows.map(row => [row.label, row.count]));
          if (next !== signature) { signature = next; since = Date.now(); }
          // Данные должны оставаться неизменными хотя бы полсекунды.
          return Date.now() - since >= 500 && {rows};
        }, 10000, 'статистика вопроса ' + text(question.querySelector('.qno')?.textContent));
        doc.body.click();
        return result;
      } catch (error) {
        if (error.name !== 'SyncShareTimeout') throw error;
        if (visibleNoAnswer(doc)) await requestReload(doc,question);
        if (attempt === 3) throw new Error('Статистика SyncShare не загрузилась или её формат не распознан за 3 попытки.');
        console.warn('Повтор чтения статистики:', attempt + 1, 'из 3');
        state.retries = (state.retries || 0) + 1;
        note('Повтор статистики ' + (attempt + 1) + '/3');
        await sleep(attempt * 1000);
      }
    }
    return false;
  };
  if (!previous && state.pageSnapshot?.page === work.document.querySelector('input[name="thispage"]')?.value) {
    state.pendingRestore ||= state.pageSnapshot;
    state.resumeQuestionId ||= state.currentQuestionId;
  }
  adapter.bind?.(state, () => capturePage(work.document));
  const report = state.report;
  const visited = new Set();
  try {
    if (!startNow) {
      const loaded = await waitForPage(state.reloadFromDoc || null);
      if (!loaded) return;
      if (loaded.finished) {state.status='finished';state.stage='Открыт обзор попытки';return;}
      const doc = loaded.doc;
      if (state.pendingRestore) await restorePage(doc);
      state.page = doc.querySelector('input[name="thispage"]')?.value;
      state.pageTotal = doc.querySelectorAll(QUESTION_SELECTOR).length;
      state.pageDone = 0;
      state.currentQuestion = text(doc.querySelector(QUESTION_SELECTOR)?.querySelector('.qno')?.textContent);
      state.status = 'ready';
      state.stage = 'Нажмите Старт. Диапазон задержки можно настроить ниже.';
      paint();
      return;
    }
    while (!stopped()) {
      try {
      const loaded = await waitForPage(state.reloadFromDoc || null);
      if (!loaded) break;
      if (loaded.finished) {
        if (state.pendingRestore) throw new Error('После перезагрузки открыт обзор. Снимок отметок сохранён; нужна ручная проверка.');
        state.status = 'finished'; console.log('Открыт обзор попытки. Проверьте ответы.'); break;
      }
      const doc = loaded.doc;
      if (state.pendingRestore) {await restorePage(doc);visited.delete(doc.querySelector('input[name="thispage"]')?.value);}
      const page = doc.querySelector('input[name="thispage"]')?.value;
      if (page === undefined || visited.has(page)) throw new Error('Не удалось определить новую страницу.');
      visited.add(page);
      state.page = page;
      state.pageTotal = doc.querySelectorAll(QUESTION_SELECTOR).length;
      state.pageDone = 0;
      note('Открыта страница ' + (Number(page) + 1));
      const questions = [...doc.querySelectorAll(QUESTION_SELECTOR)];
      const resumeAt = state.resumeQuestionId ? questions.findIndex(question => question.id === state.resumeQuestionId) : 0;
      if (resumeAt < 0) throw new Error('Не удалось найти вопрос для продолжения после перезагрузки.');
      state.resumeQuestionId = null;
      state.pageDone = resumeAt;
      for (const question of questions.slice(resumeAt)) {
        if (stopped()) break;
        const number = text(question.querySelector('.qno')?.textContent) || question.id;
        state.currentQuestion = number;
        state.currentQuestionId = question.id;
        state.stage = 'Чтение статистики';
        scrollToQuestion(question);
        paint();
        if (checkboxes(question).length) {
          await processCheckboxes(question, doc, number);
          continue;
        }
        let data = await readChoices(question, doc);
        if (!data) break;
        let rows = data.rows;
        if (!rows.length || (rows[1] && rows[0].count === rows[1].count)) {
          skipQuestion(number, 'нет допустимых ответов или равный максимум');
          continue;
        }
        await waitBetweenAnswers();
        if (stopped()) break;
        // Повторная проверка: статистика/цвет могли обновиться во время задержки.
        data = await readChoices(question, doc);
        if (!data) break;
        rows = data.rows;
        if (!rows?.length || (rows[1] && rows[0].count === rows[1].count)) {
          throw new Error('Статистика изменилась: вопрос ' + number);
        }
        const best = rows[0];
        await pauseGate();
        if (stopped()) break;
        if (!DRY_RUN) {
          if (!best.input.checked) best.input.click();
          await sleep(200);
          if (!best.input.checked) throw new Error('Ответ не выбран: вопрос ' + number);
        }
        state.lastAnswer = Date.now();
        const result = {question: number, submissions: best.count, answer: best.label, selected:1, kind:'radio'};
        saveResult(result);
        console.log(DRY_RUN ? 'Проверка' : 'Выбрано', result);
      }
      if (stopped() || DRY_RUN) break;
      const next = doc.querySelector('#mod_quiz-next-nav');
      const nextPageField = doc.querySelector('input[name="nextpage"]');
      const nextPage = Number(nextPageField?.value);
      if (!next || !/^(Следующая страница|Next page)$/i.test(text(next.value || next.textContent)) ||
          !nextPageField || !Number.isInteger(nextPage) || nextPage <= Number(page)) {
        console.log('Последняя страница. Проверьте ответы перед завершением теста.');
        state.status = 'finished';
        break;
      }
      if (!await waitFor(() => work.document !== doc || !next.disabled,
          30000, 'доступность кнопки следующей страницы')) break;
      if (work.document !== doc) throw new Error('Страница изменилась. Повторите запуск для продолжения.');
      await sleep(500);
      if (stopped()) break;
      const currentNext = doc.querySelector('#mod_quiz-next-nav');
      if (work.document !== doc || currentNext !== next || next.disabled ||
          !/^(Следующая страница|Next page)$/i.test(text(next.value || next.textContent)) ||
          Number(doc.querySelector('input[name="nextpage"]')?.value) !== nextPage) {
        throw new Error('Кнопка перехода изменилась. Повторите запуск для продолжения.');
      }
      console.log('Переход на страницу', nextPage + 1);
      state.stage = 'Сохранение ответов и переход';
      note('Переход на страницу ' + (nextPage + 1));
      await adapter.save(state, {pageSnapshot:capturePage(doc), run:true});
      next.click();
      // Только один клик: при медленном POST нельзя повторно отправлять форму.
      if (!await waitForPage(doc)) break;
      } catch (error) {
        if (error.name === 'SyncShareReload') continue;
        throw error;
      }
    }
  } catch (error) {
    state.status = 'paused';
    state.error = error.message;
    note('Приостановлено: ' + error.message);
    console.error('Приостановлено:', error.message,
      'Для продолжения нажмите Старт. Снимок ответов сохранён.');
  } finally {
    if (state.status === 'running') state.status = stopped() ? 'stopped' : 'checked';
    window.__syncShareRunning = false;
    state.countdown = false;
    if (state.status === 'finished') state.stage = 'Проверьте ответы и завершите тест самостоятельно';
    if (state.status === 'checked') state.stage = 'Пробный проход завершён. Ответы не изменены.';
    if (state.status === 'stopped') state.stage = 'Остановлено пользователем. Ответы сохранены в текущей вкладке.';
    paint();
    await adapter.save(state);
    console.table(report);
  }
})().catch(error => { console.error("SyncShare Assistant:",error); globalThis.SyncShareExtension?.failure?.(error); });


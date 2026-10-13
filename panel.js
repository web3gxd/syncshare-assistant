'use strict';
  function createPanel(doc, state, actions) {
    // Шрифт регистрируется в документе: одного @font-face внутри Shadow DOM недостаточно.
    if (doc.fonts && !doc.__syncShareMontserratFont) {
      const font = new FontFace('SyncShare Montserrat',
        'url("' + chrome.runtime.getURL('fonts/Montserrat-Variable.woff2') + '")',
        {weight:'100 900',style:'normal',display:'swap'});
      doc.__syncShareMontserratFont = font;
      doc.fonts.add(font);
      font.load().catch(error => console.warn('SyncShare Montserrat:',error.message));
    }
    doc.getElementById('syncshare-console-panel')?.remove();
    const host = doc.createElement('div');
    host.id = 'syncshare-console-panel';
    host.style.cssText = 'position:fixed;top:20px;right:20px;width:320px;max-width:calc(100vw - 24px);z-index:2147483646;';
    const ui = host.attachShadow({mode: 'open'});
    ui.innerHTML = `<style>
      :host{color-scheme:dark}.panel{font-variant-numeric:tabular-nums}*{box-sizing:border-box}button{font:inherit}
      .panel{--mint:#b9f4da;--muted:#9eafb0;--line:#304244;background:#142123;color:#edf5f3;border:1px solid #3b5152;border-radius:14px;box-shadow:0 16px 48px #07121340;font:500 13px/1.45 'SyncShare Montserrat',sans-serif;overflow:hidden}
      header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}
      .mark{width:32px;height:32px;flex-shrink:0;display:block;border-radius:8px}
      .brand{flex:1;min-width:0}.brand strong{display:block;font-size:15px;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.eyebrow{font:10px/1.5 'SyncShare Montserrat',sans-serif;letter-spacing:1.7px;color:var(--muted)}
      button{cursor:pointer;border:1px solid var(--line);background:#203234;color:#edf5f3;border-radius:7px;padding:8px 10px;transition:background .15s,border-color .15s}
      button:hover{background:#2c4445;border-color:#6c8f88}button:focus-visible{outline:2px solid var(--mint);outline-offset:3px}button:disabled{opacity:.45;cursor:default}
      .collapse{background:transparent;font-size:18px;padding:0;width:28px;height:28px}.body{padding:16px 18px}
      .statusrow{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px}.status{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--mint)}
      .dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px #b9f4da12}.time{font:11px 'SyncShare Montserrat',sans-serif;color:var(--muted)}
      .current{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.current strong{font-size:25px;font-weight:normal;letter-spacing:-1px}.current span{font:11px 'SyncShare Montserrat',sans-serif;color:var(--muted)}
      .stage{min-height:20px;color:#c7d7d6;margin:4px 0 12px;font-size:12px;overflow-wrap:anywhere}
      .track{height:4px;background:#304244;border-radius:4px;overflow:hidden}.fill{height:100%;width:0;background:var(--mint);transition:width .35s ease}
      .progress{display:flex;justify-content:space-between;color:var(--muted);font:10px 'SyncShare Montserrat',sans-serif;margin-top:7px}
      .metrics{display:grid;grid-template-columns:repeat(3,1fr);margin:16px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}.metric{padding:10px 8px;text-align:center}.metric+.metric{border-left:1px solid var(--line)}.metric b{display:block;font:21px 'SyncShare Montserrat',sans-serif;color:#effaf5}.metric small{font-size:10px;color:var(--muted)}
      .detail{padding:11px 12px;border-left:2px solid #638d7e;background:#1c2d2e;border-radius:0 6px 6px 0}.detail .eyebrow{font-size:9px;letter-spacing:1.1px}.answer{margin-top:5px;font-size:12px;max-height:74px;overflow:auto;overflow-wrap:anywhere;white-space:pre-line}.votes{margin-top:6px;color:var(--mint);font:10px 'SyncShare Montserrat',sans-serif}
      .events{display:grid;gap:5px;margin-top:12px;max-height:100px;overflow:auto;font-size:10px;color:var(--muted)}.event{display:grid;grid-template-columns:34px 1fr;gap:7px}.event time{font:10px 'SyncShare Montserrat',sans-serif;color:#7e9796}.event span{overflow-wrap:anywhere}
      .controls{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:14px}.controls button{font-size:11px}.controls .danger{color:#f2b9ad;background:transparent}.controls .start{background:var(--mint);color:#142123;border-color:var(--mint);font-weight:bold}
      .delay{border:0;padding:0;margin:14px 0 0}.delay legend{font-size:11px;color:var(--muted);float:left}.delay output{display:block;text-align:right;font:12px 'SyncShare Montserrat',sans-serif;color:var(--mint)}
      .ranges{position:relative;height:28px;clear:both;margin-top:6px}.rail{position:absolute;left:8px;right:8px;top:13px;height:3px;background:var(--line);border-radius:4px}.rail i{position:absolute;top:0;bottom:0;background:var(--mint)}
      .ranges input{appearance:none;-webkit-appearance:none;position:absolute;left:0;top:0;width:100%;height:28px;margin:0;background:transparent;pointer-events:none;border:0;padding:0}
      .ranges input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;pointer-events:auto;width:16px;height:16px;border-radius:50%;background:#142123;border:3px solid var(--mint);cursor:ew-resize;box-shadow:0 0 0 3px #142123}
      .ranges input:focus-visible{outline:none}.ranges input:focus-visible::-webkit-slider-thumb{outline:2px solid #f0c58f;outline-offset:4px}.ticks{display:flex;justify-content:space-between;color:var(--muted);font:9px 'SyncShare Montserrat',sans-serif}
      footer{display:flex;justify-content:space-between;gap:8px;margin-top:12px;font:9px 'SyncShare Montserrat',sans-serif;color:#9bb2af}.error{color:#f1bd8d}
      .body{max-height:calc(100vh - 122px);overflow:auto}[hidden]{display:none!important}@media(max-width:600px){:host{top:auto!important;bottom:12px!important;left:12px!important;right:12px!important;width:auto!important;max-width:none!important}.panel .body{max-height:50vh;overflow:auto}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style><section class="panel" aria-label="Управление SyncShare">
      <header><img class="mark" src="${chrome.runtime.getURL('icons/icon-96.png')}" width="32" height="32" alt="" aria-hidden="true"><div class="brand"><strong data-field="brand">SyncShare</strong><div class="eyebrow" data-field="brief">ПОМОЩНИК / 1.2</div></div><button class="collapse" aria-label="Свернуть панель" aria-expanded="true">−</button></header>
      <div class="body"><div class="statusrow"><div class="status" role="status" aria-live="polite"><i class="dot"></i><span data-field="status"></span></div><span class="time" data-field="time"></span></div>
      <div class="current"><strong data-field="question"></strong><span data-field="page"></span></div><div class="stage" data-field="stage"></div>
      <div class="track" role="progressbar" aria-label="Обработано на странице" aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div><div class="progress"><span>НА СТРАНИЦЕ</span><span data-field="progress"></span></div>
      <div class="metrics"><div class="metric"><b data-field="answered"></b><small>вопросов</small></div><div class="metric"><b data-field="selected"></b><small data-field="selected-label">отмечено</small></div><div class="metric"><b data-field="skipped"></b><small>пропущено</small></div></div>
      <div class="detail"><div class="eyebrow">ПОСЛЕДНИЙ РЕЗУЛЬТАТ</div><div class="answer" data-field="answer"></div><div class="votes" data-field="votes"></div></div><div class="events"></div>
      <fieldset class="delay"><legend>Задержка между вопросами</legend><output data-field="delay"></output><div class="ranges"><div class="rail"><i></i></div><input type="range" min="0.5" max="30" step="0.5" data-range="min" aria-label="Минимальная задержка, секунды"><input type="range" min="0.5" max="30" step="0.5" data-range="max" aria-label="Максимальная задержка, секунды"></div><div class="ticks"><span>ОТ <b data-field="min"></b> С</span><span>ДО <b data-field="max"></b> С</span></div></fieldset>
      <div class="controls"><button class="start" data-action="start">Старт</button><button data-action="pause">Пауза</button><button data-action="scroll" aria-pressed="true">Прокрутка ✓</button><button class="danger" data-action="stop">Стоп</button></div><footer><span>СЛУЧАЙНО · В ЗАДАННОМ ДИАПАЗОНЕ</span><span data-field="retries"></span></footer></div></section>`;
    doc.body.appendChild(host);
    const fields = Object.fromEntries([...ui.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
    ui.querySelector('.collapse').onclick = event => {
      const body = ui.querySelector('.body');
      body.hidden = !body.hidden;
      state.collapsed = body.hidden;
      event.currentTarget.textContent = body.hidden ? '+' : '−';
      event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
      update();
    };
    ui.querySelector('[data-action="start"]').onclick = actions.start;
    ui.querySelector('[data-action="pause"]').onclick = actions.pause;
    ui.querySelector('[data-action="scroll"]').onclick = actions.scroll;
    ui.querySelector('[data-action="stop"]').onclick = actions.stop;
    for (const input of ui.querySelectorAll('[data-range]')) input.oninput = () => {
      const value = Number(input.value);
      if (input.dataset.range === 'min') state.delayMin = Math.min(value,state.delayMax);
      else state.delayMax = Math.max(value,state.delayMin);
      update();
    };
    const update = () => {
      const paused = state.manualPaused || state.status === 'paused';
      const labels = {loading:'Загрузка',ready:'Готов к запуску',running:'В работе',paused:'Нужна проверка',finished:'Готово к проверке',stopped:'Остановлено',checked:'Проверка завершена'};
      fields.status.textContent = state.manualPaused ? 'На паузе' : state.dryRun && state.status === 'running' ? 'Пробный режим' : labels[state.status] || 'Загрузка';
      ui.querySelector('.status').style.color = paused ? '#f0c58f' : '#b9f4da';
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      fields.time.textContent = String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
      fields.brand.textContent = state.collapsed ? (state.currentQuestion ? 'Вопрос ' + state.currentQuestion : 'SyncShare') : 'SyncShare';
      fields.brief.textContent = state.collapsed ? fields.status.textContent + ' · готово: ' + state.report.length +
        (state.countdown ? ' · ' + ((state.remaining || 0) / 1000).toFixed(1) + 'с' : '') : 'ПОМОЩНИК / 1.2';
      fields.brief.style.letterSpacing = state.collapsed ? '0' : '1.7px';
      fields.question.textContent = state.currentQuestion ? 'Вопрос ' + state.currentQuestion : 'Подготовка';
      fields.page.textContent = state.page == null ? 'ОЖИДАНИЕ' : 'СТР. ' + (Number(state.page) + 1);
      fields.stage.textContent = state.error || (state.manualPaused ? 'Продолжите, когда будете готовы' : state.stage || 'Ожидание загрузки');
      fields.stage.classList.toggle('error', !!state.error);
      const count = state.pageDone || 0, total = state.pageTotal || 0;
      const percent = total ? Math.round(count / total * 100) : 0;
      fields.progress.textContent = count + ' / ' + total;
      ui.querySelector('.fill').style.width = percent + '%';
      ui.querySelector('.track').setAttribute('aria-valuenow', String(percent));
      fields.answered.textContent = state.report.length;
      fields.selected.textContent = state.report.reduce((sum,row) => sum + (row.selected ?? 1), 0);
      fields['selected-label'].textContent = state.dryRun ? 'к выбору' : 'отмечено';
      fields.skipped.textContent = Object.keys(state.skips).length;
      const last = state.report.at(-1);
      fields.answer.textContent = last?.answer || 'Результаты появятся после первого вопроса';
      fields.votes.textContent = last ? 'ОТВЕТОВ  ' + last.submissions + (last.unknown ? '  ·  без изменений: ' + last.unknown : '') +
        (last.fallbacks ? '  ·  красных пар: ' + last.fallbacks : '') : 'Красные исключены · для пар true/false есть исключение';
      fields.votes.style.color = last?.fallbacks ? '#f0c58f' : '#b9f4da';
      fields.retries.textContent = '↻ ' + (state.reloads || 0) + ' · закрыто ' + (state.dialogDismissals || 0);
      fields.delay.textContent = state.delayMin + '–' + state.delayMax + ' с';
      fields.min.textContent = state.delayMin; fields.max.textContent = state.delayMax;
      ui.querySelector('[data-range="min"]').value = state.delayMin;
      ui.querySelector('[data-range="max"]').value = state.delayMax;
      const fill = ui.querySelector('.rail i');
      fill.style.left = ((state.delayMin - 0.5) / 29.5 * 100) + '%';
      fill.style.right = (100 - (state.delayMax - 0.5) / 29.5 * 100) + '%';
      ui.querySelector('[data-action="start"]').disabled = ['running','loading'].includes(state.status);
      const events = ui.querySelector('.events');
      events.replaceChildren(...state.events.slice(-3).map(entry => {
        const row = doc.createElement('div');row.className='event';
        const time = doc.createElement('time'); time.textContent = entry.time;
        const value = doc.createElement('span'); value.textContent = entry.message;
        row.append(time,value); return row;
      }));
      const pause = ui.querySelector('[data-action="pause"]');
      pause.textContent = state.manualPaused ? 'Продолжить' : 'Пауза';
      pause.disabled = state.status !== 'running';
      const scroll = ui.querySelector('[data-action="scroll"]');
      scroll.textContent = state.scroll ? 'Прокрутка ✓' : 'Прокрутка —';
      scroll.setAttribute('aria-pressed', String(state.scroll));
      ui.querySelector('[data-action="stop"]').disabled = state.status !== 'running';
      ui.querySelector('.body').hidden = !!state.collapsed;
      ui.querySelector('.collapse').textContent = state.collapsed ? '+' : '−';
      ui.querySelector('.collapse').setAttribute('aria-expanded', String(!state.collapsed));
      ui.querySelector('.collapse').setAttribute('aria-label', state.collapsed ? 'Развернуть панель' : 'Свернуть панель');
    };
    return {host, update};
  }

globalThis.SyncShareAssistantUI = {createPanel};

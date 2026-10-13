'use strict';
(async () => {
  const status = document.getElementById('status'), detail = document.getElementById('detail'), show = document.getElementById('show');
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const state = await chrome.tabs.sendMessage(tab.id,{type:'ssa/status'});
    const labels = {running:'В работе',ready:'Готов к запуску',paused:'Приостановлено',stopped:'Остановлено',finished:'Обработка завершена',loading:'Загрузка'};
    status.textContent = labels[state.status] || state.status;
    detail.textContent = `Вопрос: ${state.question || '—'} · Обработано: ${state.answers || 0}` + (state.error ? '\n'+state.error : '');
    show.disabled=false;
    show.addEventListener('click',async () => {
      try {await chrome.tabs.sendMessage(tab.id,{type:'ssa/show-panel'});window.close();}
      catch {status.textContent='Обновите страницу теста.';}
    });
  } catch {
    status.textContent='Откройте страницу попытки теста РАНХиГС.';
    detail.textContent='После установки обновите страницу. Расширение SyncShare должно быть включено.';
  }
})();

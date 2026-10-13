'use strict';
const queues = new Map();
function identity(sender) {
  const url = new URL(sender.url || '');
  if (url.origin !== 'https://lms.ranepa.ru' ||
      !/^\/mod\/quiz\/(attempt|summary)\.php$/.test(url.pathname) ||
      !/^\d+$/.test(url.searchParams.get('attempt') || '') || !sender.tab?.id || sender.frameId !== 0) {
    throw new Error('Недопустимый источник сообщения');
  }
  return `session:${sender.tab.id}:${url.searchParams.get('attempt')}`;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['ssa/load','ssa/save'].includes(message?.type)) return;
  let key;
  try { key = identity(sender); } catch (error) {respond({error:error.message});return;}
  const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const record = (await chrome.storage.session.get(key))[key];
    if (message.type === 'ssa/load') {
      const documentId = sender.documentId || message.documentId;
      await chrome.storage.session.set({[key]:{...record, documentId}});
      const settings = (await chrome.storage.local.get('settings')).settings || {};
      return {state:record?.state || null, settings, resume:!!record?.run};
    }
    if (!record || record.documentId !== (sender.documentId || message.documentId)) return {stale:true};
    if (!message.state || JSON.stringify(message.state).length > 2000000) throw new Error('Слишком большой снимок');
    await chrome.storage.session.set({[key]:{documentId:record.documentId,state:message.state,run:!!message.run}});
    const {delayMin,delayMax,scroll,collapsed} = message.state;
    await chrome.storage.local.set({settings:{delayMin,delayMax,scroll,collapsed}});
    return {ok:true};
  });
  queues.set(key,task);
  task.then(respond,error => respond({error:error.message})).finally(() => {
    if (queues.get(key) === task) queues.delete(key);
  });
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter(key => key.startsWith(`session:${tabId}:`)));
});

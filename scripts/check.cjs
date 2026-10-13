'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname,'..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,pkg.version,'Версии манифеста и проекта должны совпадать');
assert.deepEqual(manifest.permissions,['storage']);
const resources = [manifest.background.service_worker,manifest.action.default_popup,
  ...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script=>script.js),
  ...manifest.web_accessible_resources.flatMap(entry=>entry.resources),
  'popup.css','popup.js','fonts/OFL.txt','assets/logo.png'];
for(const resource of resources) assert.ok(fs.statSync(path.join(root,resource)).isFile(),resource);
for(const size of [16,32,48,96,128]) {
  const png = fs.readFileSync(path.join(root,`icons/icon-${size}.png`));
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
}
const font = fs.readFileSync(path.join(root,'fonts/Montserrat-Variable.woff2'));
assert.equal(font.subarray(0,4).toString(),'wOF2');
for (const file of ['background.js','client.js','engine.js','panel.js','popup.js']) {
  execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'pipe'});
}
console.log('Манифест, версии, ресурсы, размеры иконок, локальный шрифт и синтаксис: проверено.');

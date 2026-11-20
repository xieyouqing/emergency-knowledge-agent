import fs from 'node:fs';
const css = fs.readFileSync('app/style.css', 'utf8');
const html = fs.readFileSync('app/index.html', 'utf8');

const m = css.match(/--fs-min:\s*(\d+)px/);
console.log('--fs-min:', m ? m[1] + 'px (需 ≥32)' : '未找到');

/* 检查必须只认真实标签/规则，不认注释 ——
   第一版用 includes('dailyView') 把说明性注释也算成「还在」，
   用 indexOf('app.js') 也命中了注释里的文件名，两处都是误报。 */
const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
const scriptOrder = [...noComments.matchAll(/<script src="([^"]+)"><\/script>/g)].map(
  (x) => x[1].split('?')[0]
);

const checks = [
  ['有 .msg 气泡样式', /\.msg\s*\{/.test(css)],
  ['有 .msg-user', /\.msg-user\s*\{/.test(css)],
  ['有 .msg-assistant', /\.msg-assistant\s*\{/.test(css)],
  ['有 is-emergency 标记', /is-emergency/.test(css)],
  ['有 .composer 固定输入区', /\.composer\s*\{/.test(css)],
  ['composer position:fixed', /\.composer\s*\{[^}]*position:\s*fixed/.test(css)],
  ['有 [hidden] 强制隐藏', /\.composer \[hidden\]/.test(css)],
  ['html 有 msgFlow', /id="msgFlow"/.test(noComments)],
  ['html 有 msgScroll', /id="msgScroll"/.test(noComments)],
  ['html 有 composer', /id="composer"/.test(noComments)],
  ['html 已无 dailyView 区段', !/id="dailyView"/.test(noComments)],
  ['html 已无 emergencyView 区段', !/id="emergencyView"/.test(noComments)],
  ['html 仍保留 dailyInput', /id="dailyInput"/.test(noComments)],
  ['html 仍保留 emgInput', /id="emgInput"/.test(noComments)],
  ['html 仍保留 dailyTalk', /id="dailyTalk"/.test(noComments)],
  ['html 仍保留 emgTalk', /id="emgTalk"/.test(noComments)],
  ['html 已移除 rateRow（语速功能取消）', !/id="rateRow"/.test(noComments)],
  [
    'state.js 最先（在 chat/render/speak/talk/app 之前）',
    scriptOrder.indexOf('state.js') < scriptOrder.indexOf('chat.js') &&
      scriptOrder.indexOf('state.js') < scriptOrder.indexOf('render.js') &&
      scriptOrder.indexOf('state.js') < scriptOrder.indexOf('app.js'),
  ],
  [
    'chat.js 在 render/speak/talk/app 之前',
    scriptOrder.indexOf('chat.js') < scriptOrder.indexOf('render.js') &&
      scriptOrder.indexOf('chat.js') < scriptOrder.indexOf('speak.js') &&
      scriptOrder.indexOf('chat.js') < scriptOrder.indexOf('talk.js') &&
      scriptOrder.indexOf('chat.js') < scriptOrder.indexOf('app.js'),
  ],
  ['app.js 最后', scriptOrder[scriptOrder.length - 1] === 'app.js'],
  ['全部 script 都存在于 app/ 目录', scriptOrder.every((f) => fs.existsSync('app/' + f))],
];

let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '✓ ' : '✗ ') + name);
  if (!ok) bad++;
}
console.log('script 顺序: ' + scriptOrder.join(' → '));
console.log('失败 ' + bad + ' 项');

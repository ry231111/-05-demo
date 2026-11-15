'use strict';
// 二次篩選示範：node scripts/reselect.js [需求編號] [選中ids] [淘汰ids]
// 例：node scripts/reselect.js T1 H05,H12,H30 H01,H02,H03,H04,H06,H07,H08
// 省略 ids 時：取第一輪前 10 家，第 1、4、7 名當選中，其餘 7 家當淘汰（只為示範）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {}, module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'output/bundle.js'), 'utf8'), sandbox);
const data = sandbox.window.APP_DATA;
const Engine = require(path.join(root, 'web/engine.js'));
Engine.init(data);

const [demandId = data.demands[0].id, pickedArg, rejectedArg] = process.argv.slice(2);
const demand = data.demands.find(d => d.id === demandId);
if (!demand) {
  console.error('找不到需求 ' + demandId + '；可用：' + data.demands.map(d => d.id).join('、'));
  process.exit(1);
}
const split = s => String(s || '').split(/[,，\s]+/).filter(Boolean);

const first = Engine.rank(demand.conditions);
const firstRank = new Map(first.candidates.map(c => [c.org_id, c.rank]));
const reviewed = first.candidates.slice(0, 10).map(c => c.org_id);
let picked = split(pickedArg), rejected = split(rejectedArg);
if (!picked.length) picked = [0, 3, 6].map(i => reviewed[i]).filter(Boolean);
if (!rejected.length) rejected = reviewed.filter(id => !picked.includes(id));

const known = new Set(data.orgs.orgs.map(o => o.id));
const unknown = [...picked, ...rejected].filter(id => !known.has(id));
if (unknown.length) console.warn('⚠ 找不到這些組織編號，已略過：' + unknown.join('、'));

console.log('=== ' + demand.id + ' ' + demand.title + ' ===');
console.log('第一輪：' + first.candidates.length + ' 家（目標 ' + first.target_n + ' 家）');
console.log('選中 ' + picked.length + ' 家：' + picked.join('、'));
console.log('淘汰 ' + rejected.length + ' 家：' + rejected.join('、'));

const learned = Engine.learnFromSelection(first, picked, rejected);
console.log('\n--- 學到的標籤 ---');
if (!learned.length) console.log('（兩組差異不明顯，沒有學到標籤；名單只做刪淘汰、補位）');
learned.forEach(l => console.log((l.delta > 0 ? '＋目標 ' : '－避開 ') + l.rule + ' ' + l.label +
  '｜選中 ' + l.picked + '、淘汰 ' + l.rejected + '｜分數 ' + (l.delta > 0 ? '+' : '') + l.delta));

const second = Engine.rank(Object.assign({}, demand.conditions,
  { learned, locked: picked, removed: rejected }));
const reviewedSet = new Set([...picked, ...rejected]);
console.log('\n--- 補位後名單（' + second.candidates.length + ' 家） ---');
second.candidates.forEach(c => {
  // 只有遞補進「顧問審閱的前 N 家」位置的才標新補位
  const tag = c.locked ? '🔒選中' :
    c.rank <= reviewedSet.size && !reviewedSet.has(c.org_id) ? '🆕補位' : '　　　';
  const was = firstRank.has(c.org_id) ? '第一輪第 ' + firstRank.get(c.org_id) + ' 名' : '第一輪未入選';
  const why = (c.learned_matched || []).map(l => (l.delta > 0 ? '+' : '') + l.delta + ' ' + l.label);
  console.log(String(c.rank).padStart(2) + '. ' + tag + ' ' + c.org_id + ' ' + c.name +
    '｜' + c.score.toFixed(2) + '｜' + was + (why.length ? '｜' + why.join('、') : ''));
});
const leaked = second.candidates.filter(c => rejected.includes(c.org_id));
if (leaked.length) {
  console.error('✗ 淘汰的組織仍在名單：' + leaked.map(c => c.org_id).join('、'));
  process.exit(1);
}
const fresh = second.candidates.slice(picked.length, picked.length + rejected.length);
console.log('\n頂替淘汰 ' + rejected.length + ' 家的新 ' + fresh.length + ' 家：' +
  fresh.map(c => c.org_id).join('、'));
if (second.relaxed.length) console.log('放寬：' + second.relaxed.map(r => r.field).join('、'));

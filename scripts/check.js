'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {}, module: { exports: {} } };
for (const file of ['output/bundle.js', 'web/engine.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const data = sandbox.window.APP_DATA;
const Engine = sandbox.window.Engine;
assert.equal(Engine, sandbox.module.exports, '瀏覽器與 Node 應公開相同 API');
Engine.init(data);

function first(items) {
  return items.length ? items[0].text : '無';
}

const results = [];
for (const demand of data.demands.slice(0, 4)) {
  console.log('\n=== ' + demand.id + ' ' + demand.title + ' ===');
  const parsed = Engine.parseSentence(demand.sentence);
  console.log('句子解析：', JSON.stringify(parsed, null, 2));
  const result = Engine.rank(demand.conditions);
  results.push(result);
  console.log('既有需求排序：target_n=' + result.target_n +
    '；候選=' + result.candidates.length + '；excluded=' + result.excluded.length);
  console.log('relaxed：', JSON.stringify(result.relaxed));
  console.log('disabled_rules：', JSON.stringify(result.disabled_rules));
  result.candidates.slice(0, 10).forEach(c => {
    assert.ok(Number.isFinite(c.score));
    console.log(c.rank + '. ' + c.org_id + ' ' + c.name + ' | ' +
      c.score.toFixed(2) + ' | ' + c.hard_status);
    console.log('  理由：' + first(c.reasons));
    console.log('  警訊：' + first(c.warnings));
  });
  result.candidates.slice(1).forEach((candidate, index) => {
    assert.ok(result.candidates[index].reasons.length >= candidate.reasons.length,
      '候選名單必須依符合項目數由高至低排列');
  });
  const chosen = result.candidates.find(c => !c.demoted);
  assert.ok(chosen, '示範需求應有可標回饋的候選');
  const feedback = Engine.feedbackItem(chosen.org_id, '不符合', '其他', '冒煙測試：確認移至最後');
  const reranked = Engine.rank(demand.conditions, [feedback]);
  const demoted = reranked.candidates.find(c => c.org_id === chosen.org_id);
  assert.ok(demoted?.demoted, '不符合回饋應保留為降序候選');
  assert.equal(demoted.score, chosen.score, '回饋只重排，不更動分數');
  const replacement = reranked.candidates.filter(c => !c.demoted);
  assert.ok(replacement.length >= Math.min(result.target_n, result.candidates.length - 1));
  assert.equal(JSON.parse(Engine.exportFeedback([feedback]))[0].by, 'PM');
  console.log('回饋驗證通過：' + chosen.org_id + ' 保留降序狀態；未標不符合的候選 ' + replacement.length + ' 家。');
}
assert.equal(results.length, 4, '應執行四個示範需求');

const candidates = results[0].candidates;
const prompt = Engine.buildPrompt(data.demands[0].conditions, candidates);
console.log('\n=== 第一個需求：Claude 提示詞前 30 行 ===');
console.log(prompt.split('\n').slice(0, 30).join('\n'));

const owner = candidates.find(c => [...c.reasons, ...c.warnings]
  .some(item => item.evidence.some(e => /^[CN]\d+$/.test(e.record_id))));
assert.ok(owner, '應有含紀錄證據的候選');
const evidence = [...owner.reasons, ...owner.warnings].flatMap(item => item.evidence);
const ownRecord = evidence.find(e => /^[CN]\d+$/.test(e.record_id)).record_id;
const other = data.orgs.orgs.find(org => org.id !== owner.org_id && org.timeline.length);
assert.ok(other);
const foreignRecord = other.timeline[0].id;
const allIds = new Set(data.orgs.orgs.flatMap(org => org.timeline.map(record => record.id)));
let unknown = 'C999999';
while (allIds.has(unknown)) unknown += '9';
const reply = '### ' + owner.org_id + ' ' + owner.name + '\n' +
  '- 推薦理由：引用本組織證據 [' + ownRecord + ']\n' +
  '- 要注意：不存在的紀錄 [' + unknown + ']\n' +
  '- 電訪先問：誤用其他組織的紀錄 [' + foreignRecord + ']';
const verified = Engine.verifyReply(reply, candidates);
assert.equal(verified.ok_count, 1);
assert.equal(verified.bad_count, 2);
assert.equal(verified.items.map(item => item.status).join(','), 'ok,not_found,wrong_org');
console.log('\n=== 引用查核 ===\n' + reply);
console.log(JSON.stringify(verified, null, 2));
// Small synthetic inputs exercise branches absent from the four demo shortlists.
const fixture = {
  orgs: { meta: { disabled_rules: [{ id: 'OFF', reason: '測試停用' }] }, orgs: [
    { id: 'ORG101', name: '符合', fields: { 區域: '北部' }, hits: [
      { rule: 'ON', evidence: [] }, { rule: 'OFF', evidence: [] }], timeline: [] },
    { id: 'ORG102', name: '放寬', fields: { 區域: '南部' }, hits: [], timeline: [] },
    { id: 'ORG103', name: '缺值', fields: {}, hits: [], timeline: [] }
  ] },
  rules: { rules: [
    { id: 'ON', label: '訊號', meaning: '測試', kind: 'tag', weights: { 例行課: 2 } },
    { id: 'OFF', label: '停用', meaning: '測試', kind: 'tag', weights: { 例行課: 100 } }
  ] },
  conditions: { soft: {
    bonus: { any: ['ON'], none: ['OFF'], bonus: 1, explain: '測試加分' },
    penalty: { none: ['ON'], penalty: -0.5, explain: '測試扣分' }
  }, scenario_defaults: {} }, feedback: []
};
Engine.init(fixture);
const condition = { scenario: '例行課', need_n: 3, multiplier: 1,
  hard: { 區域: ['北部'] }, soft: ['bonus', 'penalty'] };
const edge = Engine.rank(condition);
assert.equal(edge.relaxed[0].field, '區域');
assert.equal(edge.candidates.map(c => c.hard_status).join(','), 'match,relaxed,missing');
assert.equal(edge.candidates[0].score, 2.5, '缺權重係數當 1；停用規則不計分也不觸發軟條件');
assert.equal(edge.candidates[2].missing_fields[0], '區域');
const restored = Engine.rank(condition, [
  { org_id: 'ORG101', verdict: '不符合', date: '2026-01-01' },
  { org_id: 'ORG101', verdict: '符合', date: '2026-02-01' }
]);
assert.equal(restored.candidates[0].demoted, false, '最新日期回饋優先');
Engine.init(data);
assert.equal(Engine.parseSentence('找二十家南部全職3-30人的組織').need_n, 20);
assert.equal(Engine.parseSentence('找5 家全職三到三十人').hard.全職人數.max, 30);
const nodeEngine = require(path.join(root, 'web/engine.js'));
nodeEngine.init(data);
assert.equal(nodeEngine.rank(data.demands[0].conditions).candidates[0].org_id,
  results[0].candidates[0].org_id);
console.log('\n補充驗證通過：放寬／缺值排序、停用規則、軟條件加扣分、最新回饋、數字解析及 Node 載入。');
console.log('冒煙測試通過（未比對預期名單）。');

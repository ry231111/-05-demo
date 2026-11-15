/* 好事媒合助手：只處理畫面與 PM 操作，排序與引用判定交給 Engine。 */
(() => {
  'use strict';
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const arr = value => Array.isArray(value) ? value : value == null ? [] : [value];
  const display = value => value == null || value === '' ? '資料缺' : typeof value === 'boolean' ? (value ? '已上架' : '未上架') : Array.isArray(value) ? value.join('、') : String(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const data = window.APP_DATA;
  const STORE = 'good-match-pm-v1';
  const VOTES = 'good-match-labels-v1';
  const PEOPLE = 'good-match-people-v1';
  const LABEL_HISTORY = 'good-match-label-history-v1';
  const DISCUSSIONS = 'good-match-discussions-v1';
  let storageAvailable = true;
  function read(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch (_) { storageAvailable = false; return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { storageAvailable = false; toast('已保留本次操作；此瀏覽器無法保存，關閉前請下載回饋。'); }
  }
  const feedbackKey = f => [f.org_id, f.verdict, arr(f.reason_code).join('、'), f.primary_label || '', f.note || '', arr(f.tags).join('、'), f.by || '', f.date || ''].join('|');
  const saved = read(STORE, {items:[], deleted:[]});
  const deleted = new Set(arr(saved.deleted));
  const seed = arr(data?.feedback?.items || data?.feedback?.feedback || data?.feedback);
  const feedbackMap = new Map([...seed, ...arr(saved.items)].filter(f => f && f.org_id && !deleted.has(feedbackKey(f))).map(f => [feedbackKey(f), f]));
  let feedback = [...feedbackMap.values()];
  const votes = read(VOTES, {});
  const people = read(PEOPLE, ['PM', '資深顧問', '會員窗口', '其他夥伴']);
  const labelHistory = read(LABEL_HISTORY, []);
  const discussions = read(DISCUSSIONS, []);
  const state = { step:1, sentence:'', conditions:null, result:null, selected:null, reply:'', verified:null, prompt:'', focusRecord:null, priorityLabels:[] };
  const orgs = arr(data?.orgs?.orgs);
  const meta = data?.orgs?.meta || {};
  const settings = data?.conditions || {};
  const demands = arr(data?.demands);
  const orgById = id => orgs.find(o => o.id === id);
  const scenarioCopy = {'實驗課':'找願意先試一輪的夥伴','例行課':'找到穩定參與、能落實的組織','企業陪跑':'讓專業支持遇見合適的需求','年度走訪':'先關心最近需要支持的組織'};
  const reasonEntries = Object.entries(settings.feedback_reasons || {}).filter(([key]) => !key.startsWith('_'));
  const softEntries = Object.entries(settings.soft || {}).filter(([key]) => !key.startsWith('_'));
  let lastDrawerFocus = null;
  let hoverEvidenceTimer;
  let toastTimer;
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  function persist() { write(STORE, {items:feedback, deleted:[...deleted]}); }
  function persistDiscussions() { write(DISCUSSIONS, discussions); }
  function personOptions(selected = '') {
    return people.map(person => '<option value="'+esc(person)+'" '+(person === selected ? 'selected' : '')+'>'+esc(person)+'</option>').join('')+
      '<option value="__new__">＋新增留言人</option>';
  }
  function recordLabelEdit(orgId, action, label, by, reason = '', kind = 'positive') {
    labelHistory.push({org_id:orgId, action, label, by, reason, kind, date:new Date().toISOString()});
    write(LABEL_HISTORY, labelHistory);
  }
  function labelKind(orgId, label) {
    const org = orgById(orgId);
    const hit = arr(org?.hits).find(item => item.label === label);
    if (hit) return hit.kind === 'warning' ? 'hesitation' : 'positive';
    const discussion = discussions.find(item => item.org_id === orgId && arr(item.tags).includes(label));
    if (discussion) return discussion.tag_kind || 'positive';
    const item = feedback.find(record => record.org_id === orgId &&
      (record.primary_label === label || arr(record.tags).includes(label)));
    if (item) return item.tag_kinds?.[label] || (item.verdict === '不符合' ? 'hesitation' : 'positive');
    return 'positive';
  }
  function signalBadge(label, kind) {
    const hesitation = kind === 'hesitation';
    return '<span class="badge '+(hesitation ? 'amber' : 'green')+' signal-badge"><span class="signal-kind">'+(hesitation ? '猶豫訊號' : '正向訊號')+'</span>'+esc(label)+'</span>';
  }
  function priorityLabelKind(label, candidates) {
    const candidate = candidates.find(item => [...arr(item.reasons), ...arr(item.warnings)].some(reason => reason.label === label));
    return candidate ? labelKind(candidate.org_id, label) : 'positive';
  }
  function labelHistoryPanel(orgId) {
    const entries = labelHistory.filter(item => item.org_id === orgId).slice().reverse();
    return '<div class="panel label-history-panel"><div class="section-label"><h2>標籤編輯紀錄</h2><span class="badge">'+entries.length+' 筆</span></div>'+
      (entries.length ? '<div class="label-history-list">'+entries.map(item => '<article class="label-history-item"><div><span class="badge '+(item.action === 'add' ? 'green' : 'amber')+'">'+(item.action === 'add' ? '新增標籤' : '刪除標籤')+'</span> '+signalBadge(item.label, item.kind)+'<p class="body-copy">'+(item.action === 'delete' ? '原因：'+esc(item.reason || '未填寫') : '來源：一句話回饋')+'</p></div><small class="muted">'+esc(item.by || 'PM')+' · '+esc(item.date.replace('T',' ').slice(0,16))+'</small></article>').join('')+'</div>' :
        '<p class="body-copy">還沒有標籤編輯紀錄。新增或移除標籤後，這裡會留下可追溯的紀錄。</p>')+'</div>';
  }
  function engineReady() {
    if (!window.Engine || !data) { toast(!data ? '組織資料尚未載入，請確認資料檔已準備好。' : '媒合功能尚未載入；請等媒合檔準備好後重新整理。'); return false; }
    return true;
  }
  function runEngine(action) {
    if (!engineReady()) return;
    try { return action(); } catch (error) { console.error(error); toast('這次處理未完成，請確認條件後再試一次。'); }
  }
  function heading(num, title, subtitle, right = '') {
    return '<div class="page-heading"><div><h1>'+title+'</h1><p class="subtitle">'+subtitle+'</p></div>'+right+'</div>';
  }
  function empty(title, text, action = 'back-input', button = '回到需求輸入') {
    return '<div class="empty"><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><button class="primary" data-action="'+action+'">'+esc(button)+'</button></div>';
  }
  function go(step) {
    state.step = Number(step);
    if (state.step === 2) renderResults();
    if (state.step === 3) renderDetail();
    if (state.step === 4) renderFeedback();
    if (state.step === 5) renderPrompt();
    document.querySelectorAll('.page').forEach((el, i) => { el.hidden = i + 1 !== state.step; });
    if (state.step !== 3) {
      $('#step-3').classList.remove('side-detail-open');
      document.body.classList.remove('inline-detail-open');
    }
    const navStep = state.step === 1 ? 1 : state.step === 5 ? 5 : 2;
    document.querySelectorAll('[data-step]').forEach(el => {
      const active = Number(el.dataset.step) === navStep;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    $('#main').focus({preventScroll:true}); window.scrollTo({top:0, behavior:'auto'});
  }
  function optionsFor(field) {
    const options = settings.hard_fields?.[field]?.options || [];
    return [...new Set([...options, ...orgs.flatMap(o => arr(o.fields?.[field]))].filter(v => v != null && v !== ''))];
  }
  function chipGroup(field, values, selected) {
    return '<div class="chips">'+values.map(value => '<button type="button" class="chip '+(arr(selected).includes(value) ? 'selected' : '')+'" data-chip="'+esc(field)+'" data-value="'+esc(value)+'" aria-pressed="'+arr(selected).includes(value)+'">'+esc(value)+'</button>').join('')+'</div>';
  }
  function renderInput() {
    $('#step-1').innerHTML = heading('01', '下一個好合作，從一句話開始', '說說這次計畫想找誰，我們一起把合適的組織找出來。') +
      '<div class="intake-layout"><div><div class="panel intake-panel"><div class="section-label"><h2>這次，想找什麼樣的夥伴？</h2></div><label class="muted" for="sentence">把企業或計畫的一句話需求貼進來</label><div class="composer" data-role="composer"><div class="composer-drop-hint">放開以附加檔案</div><div class="composer-chips" data-role="chips"></div><textarea id="sentence" data-role="text" placeholder="輸入需求，或附加檔案…">'+esc(state.sentence)+'</textarea><div class="composer-bar"><input type="file" data-role="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.zip"><button class="composer-attach" data-role="attach" type="button">附加檔案</button><span class="composer-count" data-role="count"></span><button class="composer-send" data-role="send" type="button" aria-label="送出" disabled>↑</button></div></div><div class="input-footer"><small class="muted">不用先想好條件，照平常說話的方式寫就好。</small><button class="primary" data-action="parse">轉成條件</button></div><p class="example-label">還沒想好？用一個常見需求開始</p><div class="examples">'+demands.map((d, i) => '<button data-demand="'+i+'">'+esc(d.title)+'</button>').join('')+'</div></div><div id="conditions-form"></div></div></div>';
    initComposer($('#step-1 [data-role="composer"]'));
    renderConditions();
  }
  function initComposer(root) {
    if (!root) return;
    const maxFiles = 5, maxSize = 10 * 1024 * 1024;
    const allowed = /^(image\/|application\/pdf|text\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel|zip|x-zip))/;
    const allowedExt = /\.(pdf|txt|md|csv|docx?|xlsx?|zip|png|jpe?g|gif|webp|svg|heic)$/i;
    const text = root.querySelector('[data-role="text"]');
    const input = root.querySelector('[data-role="file"]');
    const chips = root.querySelector('[data-role="chips"]');
    const count = root.querySelector('[data-role="count"]');
    const send = root.querySelector('[data-role="send"]');
    let files = [];
    let dragDepth = 0;
    const size = bytes => bytes < 1024 ? bytes+' B' : bytes < 1048576 ? (bytes/1024).toFixed(1)+' KB' : (bytes/1048576).toFixed(1)+' MB';
    const showError = message => toast(message);
    function render() {
      chips.replaceChildren(...files.map((item, index) => {
        const chip = document.createElement('div'); chip.className = 'composer-chip';
        const name = document.createElement('span'); name.className = 'composer-name'; name.textContent = item.file.name;
        const meta = document.createElement('small'); meta.textContent = size(item.file.size);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'composer-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除 '+item.file.name); remove.dataset.index = index;
        chip.append(name, meta, remove); return chip;
      }));
      count.textContent = files.length ? files.length+'/'+maxFiles : '';
      send.disabled = !text.value.trim() && !files.length;
    }
    function addFiles(list) {
      const errors = [];
      for (const file of list) {
        if (files.length >= maxFiles) { errors.push('最多只能附加 '+maxFiles+' 個檔案'); break; }
        if (!allowed.test(file.type) && !allowedExt.test(file.name)) { errors.push('「'+file.name+'」格式不支援'); continue; }
        if (file.size > maxSize) { errors.push('「'+file.name+'」超過 10.0 MB'); continue; }
        if (!files.some(item => item.file.name === file.name && item.file.size === file.size)) files.push({file});
      }
      if (errors.length) showError(errors.join('；'));
      render();
    }
    root.querySelector('[data-role="attach"]').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    chips.addEventListener('click', event => {
      const button = event.target.closest('.composer-remove'); if (!button) return;
      files.splice(Number(button.dataset.index), 1); render();
    });
    text.addEventListener('input', render);
    text.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send.click(); }
    });
    text.addEventListener('paste', event => {
      const pasted = [...(event.clipboardData?.files || [])];
      if (pasted.length) { event.preventDefault(); addFiles(pasted); }
    });
    root.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; root.classList.add('is-dragging'); });
    root.addEventListener('dragover', event => event.preventDefault());
    root.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('is-dragging'); } });
    root.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; root.classList.remove('is-dragging'); addFiles(event.dataTransfer.files); });
    send.addEventListener('click', () => {
      if (send.disabled) return;
      console.log('送出：', text.value.trim(), files.map(item => item.file));
      toast('已送出示範內容（目前只記錄在 console）。');
      files = []; text.value = ''; render();
    });
    render();
  }
  function readableMatch(text) {
    return String(text).replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, fragment => {
      try {
        const obj = JSON.parse(fragment);
        if ('min' in obj || 'max' in obj) return [obj.min == null ? '' : '最少 '+obj.min+' 人',obj.max == null ? '' : '最多 '+obj.max+' 人'].filter(Boolean).join('、');
        return [obj.scenario, ...arr(obj.soft), ...Object.keys(obj.hard || {})].filter(Boolean).join('、');
      } catch (_) { return '對應的媒合條件'; }
    });
  }
  function renderConditions() {
    const el = $('#conditions-form');
    const c = state.conditions;
    if (!c) { el.innerHTML = ''; return; }
    const hard = c.hard || {};
    const extraFields = Object.keys(settings.hard_fields || {}).filter(f => !['議題','區域','全職人數'].includes(f));
    el.innerHTML = '<div class="panel conditions-panel"><div class="section-label"><h2>確認這次的媒合條件</h2></div><p class="body-copy">這是第一版條件，你可以依照計畫需要再調整。</p>'+ (arr(c._matched).length ? '<div class="notice matched">系統從你的句子讀到：'+arr(c._matched).map(readableMatch).map(esc).join('；')+'</div>' : '')+
      '<div class="form-row"><div class="form-label">這次是什麼計畫？</div><div class="segments">'+Object.entries(scenarioCopy).map(([name, text]) => '<button type="button" class="'+(c.scenario === name ? 'selected' : '')+'" data-scenario="'+esc(name)+'" aria-pressed="'+(c.scenario === name)+'"><strong>'+name+'</strong><small>'+text+'</small></button>').join('')+'</div></div>'+
      '<div class="form-row"><div class="form-label">先找幾家候選？</div><div class="inline-fields"><label>需要 <input id="need-n" type="number" min="1" max="999" value="'+esc(c.need_n)+'"> 家</label><label>候選倍數 <input id="multiplier" type="number" min="1" max="20" value="'+esc(c.multiplier)+'"> 倍</label><span class="estimate" id="estimate">將列出 '+esc(c.need_n * c.multiplier)+' 家候選</span></div></div>'+
      '<div class="form-row"><div class="form-label">議題 <small>可複選；不選代表不限</small></div>'+chipGroup('議題', optionsFor('議題'), hard['議題'])+'</div>'+
      '<div class="form-row"><div class="form-label">區域 <small>可複選；不選代表不限</small></div>'+chipGroup('區域', optionsFor('區域'), hard['區域'])+'</div>'+
      '<details class="advanced-conditions"><summary>調整更多條件</summary><div class="form-row"><div class="form-label">全職人數 <small>留空代表不限</small></div><div class="inline-fields"><label>最少 <input id="staff-min" type="number" min="0" value="'+esc(hard['全職人數']?.min)+'"> 人</label><span>—</span><label>最多 <input id="staff-max" type="number" min="0" value="'+esc(hard['全職人數']?.max)+'"> 人</label></div></div>'+
      '<div class="form-row"><div class="form-label">希望組織具備的特質 <small>加分條件，沒有符合也會保留考量</small></div><div class="chips">'+softEntries.map(([name, item]) => '<button type="button" title="'+esc(item.explain)+'" class="chip '+(arr(c.soft).includes(name) ? 'selected' : '')+'" data-chip="soft" data-value="'+esc(name)+'" aria-pressed="'+arr(c.soft).includes(name)+'">'+esc(name)+'</button>').join('')+'</div><div class="explanations">'+softEntries.filter(([name]) => arr(c.soft).includes(name)).map(([name, item]) => '<span>'+esc(name)+'：'+esc(item.explain)+'</span>').join('')+'</div></div>'+
      '<div class="form-row"><label class="switch"><input id="exclude-partner" type="checkbox" '+(c.exclude_recent_partner ? 'checked' : '')+'><span>排除近一年合作過的</span></label><p class="body-copy">近一年已陪跑或獎補助合作的組織，先留給下一次機會。</p></div>'+
      '<div class="form-row"><div class="form-label">其他條件</div>'+extraFields.map(field => '<div class="form-row"><div class="form-label">'+esc(field)+'</div>'+chipGroup(field, optionsFor(field), hard[field])+'</div>').join('')+'<label for="relax-order">名單不足時，依序放寬</label><select id="relax-order">'+['區域,全職人數,議題','全職人數,區域,議題','議題,區域,全職人數'].map(value => '<option value="'+value+'" '+(arr(c.relax_order).join(',') === value ? 'selected' : '')+'>'+value.replaceAll(',', ' → ')+'</option>').join('')+'</select></div></details>'+
      '<div class="actions"><span class="muted">先有一份名單，再用你的經驗選出好夥伴。</span><button class="primary" data-action="rank">產生推薦名單</button></div></div>';
  }
  function collectConditions() {
    if (!state.conditions) return null;
    const c = state.conditions;
    const need = $('#need-n'), multiple = $('#multiplier'), min = $('#staff-min'), max = $('#staff-max');
    for (const input of [need, multiple, min, max]) { if (!input.checkValidity()) { input.reportValidity(); return null; } }
    if (!need.value || !multiple.value) { toast('請填寫需要家數與候選倍數。'); return null; }
    if (min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value)) { toast('最少人數不能大於最多人數。'); min.focus(); return null; }
    c.need_n = Number(need.value); c.multiplier = Number(multiple.value);
    c.hard['全職人數'] = {min:min.value === '' ? null : Number(min.value), max:max.value === '' ? null : Number(max.value)};
    c.exclude_recent_partner = $('#exclude-partner').checked;
    c.relax_order = $('#relax-order').value.split(',');
    return c;
  }
  function rerank() {
    return runEngine(() => { Engine.init({...data, feedback:[]}); state.result = Engine.rank(state.conditions, feedback); state.verified = null; return state.result; });
  }
  function evidenceButtons(evidence, orgId) {
    return arr(evidence).filter((e,i,list) => e?.record_id && list.findIndex(other => other.record_id === e.record_id) === i).map(e => '<button class="evidence-button" data-evidence="'+esc(e.record_id)+'" data-org="'+esc(orgId)+'" data-quote="'+esc(e.quote || '')+'" aria-label="查看紀錄 '+esc(e.record_id)+'">'+esc(e.record_id)+'</button>').join('');
  }
  function cleanReason(text, label) {
    let value = String(text || '').replace(/\s*\[[A-Z]{1,3}\d+\]/g, '').trim();
    if (label && value.startsWith(label+'：')) value = value.slice(label.length+1);
    return value;
  }
  function reasonColumn(title, list, kind, orgId, fallback) {
    const renderReason = r => {
      const ids = [...new Set((String(r.text || '').match(/\b[A-Z]{1,3}\d+\b/g) || []))];
      const refs = arr(r.evidence).length ? arr(r.evidence) : ids.map(id => ({record_id:id}));
      return '<div class="reason"><strong>'+esc(r.label || cleanReason(r.text))+'</strong><span class="rule">'+esc(r.rule)+'</span>'+(r.label && r.text && r.text !== r.label ? '<p>'+esc(cleanReason(r.text,r.label))+'</p>' : '')+evidenceButtons(refs,orgId)+'</div>';
    };
    const visible = list.slice(0,3), more = list.slice(3);
    return '<div class="reason-column"><div class="reason-title '+kind+'">'+title+'</div>'+(list.length ? visible.map(renderReason).join('')+(more.length ? '<details class="more-reasons"><summary>再看 '+more.length+' 條'+(kind === 'warning' ? '提醒' : kind === 'call' ? '電訪問題' : '推薦依據')+'</summary>'+more.map(renderReason).join('')+'</details>' : '') : '<p class="reason muted">'+fallback+'</p>')+'</div>';
  }
  function latestFeedback(id) { return feedback.filter(f => f.org_id === id).slice().sort((a,b) => String(a.date || '').localeCompare(String(b.date || ''))).at(-1); }
  function candidateCard(c, i, maxScore) {
    const f = c.fields || orgById(c.org_id)?.fields || {};
    const latest = latestFeedback(c.org_id);
    const demoted = c.demoted || latest?.verdict === '不符合';
    const score = Number(c.score) || 0;
    const scoreWidth = Math.max(0, Math.min(100, score / maxScore * 100));
    const tagFields = ['議題', '區域', '全職人數', '會籍'];
    const reasons = arr(c.reasons), warnings = arr(c.warnings), calls = arr(c.call_questions);
    const priority = state.priorityLabels.filter(label => [...reasons, ...warnings].some(item => item.label === label));
    const fitMax = Math.max(1, ...arr(state.result?.candidates).map(item => arr(item.reasons).length));
    const fitRatio = Math.min(1, reasons.length / fitMax);
    const fitLevel = fitRatio >= .67 ? '高' : fitRatio >= .34 ? '中' : '低';
    return '<article class="candidate '+(demoted ? 'demoted' : '')+'" data-candidate="'+esc(c.org_id)+'"><div class="candidate-top"><div class="candidate-identity"><span class="rank">'+String(i + 1).padStart(2, '0')+'</span><div><h2>'+esc(c.name)+'</h2><div class="org-tags">'+tagFields.map(key => '<span class="badge">'+esc(display(f[key]))+(key === '全職人數' && f[key] != null ? ' 人' : '')+'</span>').join('')+(c.hard_status === 'relaxed' ? '<span class="badge amber">放寬後納入</span>' : '')+(c.hard_status === 'missing' || arr(c.missing_fields).length ? '<span class="badge amber">資料缺：'+arr(c.missing_fields).map(esc).join('、')+'</span>' : '')+'</div></div></div><div class="score"><small>排序摘要</small><strong>符合 '+reasons.length+' 項</strong><span class="score-detail">符合程度：'+fitLevel+(warnings.length ? ' · 待確認 '+warnings.length+' 項' : '')+'</span><div class="fit-meter" role="img" aria-label="符合程度 '+fitLevel+'，符合 '+reasons.length+' 項"><span style="width:'+Math.max(8, fitRatio*100)+'%"></span></div></div></div>'+reasonSummary(c.org_id, latest)+
      '<details class="candidate-evidence"><summary>查看推薦依據、待確認與電訪問題</summary><div class="candidate-body">'+
      reasonColumn('推薦依據', reasons, '', c.org_id, '符合目前條件，可進一步認識。')+
      reasonColumn('待確認', warnings, 'warning', c.org_id, '目前沒有明確警訊，仍建議電訪確認。')+
      reasonColumn('電訪問題', calls, 'call', c.org_id, '確認參與意願、可投入人力與期待。')+'</div></details>'+
      (arr(c.soft_matched).length ? '<div class="soft-matches">'+arr(c.soft_matched).map(s => '<span class="badge '+(s.delta < 0 ? 'amber' : 'green')+'" title="'+esc(s.explain)+'">'+esc(s.name)+'</span>').join('')+'</div>' : '')+
      '<div class="candidate-footer"><div class="feedback-actions"><span>你的判斷，讓名單更貼近現場</span><button class="small-button '+(latest?.verdict === '符合' ? 'secondary' : '')+'" data-verdict="符合" data-org="'+esc(c.org_id)+'">符合</button><button class="small-button" data-verdict="不符合" data-org="'+esc(c.org_id)+'">不符合</button></div><button class="secondary small-button" data-detail="'+esc(c.org_id)+'">查看組織脈絡</button></div>'+
      (latest ? '<div class="feedback-note"><span>'+(latest.verdict === '符合' ? 'PM 認為符合這次需求' : 'PM 判斷不符合 · '+esc(latest.reason_code || '其他'))+(latest.note ? '：'+esc(latest.note) : '')+(demoted ? ' · 已移至名單最後' : '')+'</span><button class="text-button small-button" data-discuss="'+esc(c.org_id)+'">加入討論</button></div>' : '')+'</article>';
  }
  function renderResults() {
    const el = $('#step-2');
    if (!state.result) { el.innerHTML = heading('02', '找到值得先聊聊的夥伴', '每一個推薦，都能回到原始紀錄。')+empty('先告訴我們，這次想找誰', '輸入需求並確認條件，就能產生第一波候選名單。'); return; }
    const r = state.result, candidates = arr(r.candidates);
    const maxScore = Math.max(1, ...candidates.map(c => Number(c.score) || 0));
    const disabled = arr(r.disabled_rules);
    el.innerHTML = heading('02', '這些組織，值得先聊聊', '先在這個工作區比較、查看依據，再留下本次媒合判斷。', '<div class="result-heading-tools"><div class="result-metrics"><div class="metric-pill"><b>'+candidates.length+'</b>候選組織</div><button class="secondary" data-step="5">看目前的待決策名單</button></div>'+(state.priorityLabels.length ? '<div class="priority-summary"><span class="priority-summary-title">主要推薦原因</span>'+state.priorityLabels.map(label => signalBadge(label, priorityLabelKind(label, candidates))).join('')+'</div>' : '')+'</div>')+
      (arr(r.relaxed).length ? '<div class="notice">名單不足，已自動放寬：'+r.relaxed.map(item => esc(item.field)+'（原本：'+esc(typeof item.original === 'object' && !Array.isArray(item.original) ? Object.entries(item.original || {}).map(([key,value]) => (key === 'min' ? '最少' : key === 'max' ? '最多' : key)+display(value)).join('、') : display(item.original))+'）'+(item.note ? ' · '+esc(item.note) : '')).join('；')+'</div>' : '')+
      (disabled.length ? '<details class="notice warning"><summary>有 '+disabled.length+' 條規則因資料缺欄位停用</summary>'+disabled.map(d => '<p>'+esc(d.id)+'：'+esc(d.reason)+'</p>').join('')+'</details>' : '')+
      '<div class="results-tools"><span>先看推薦理由，再用現場經驗確認。分數只協助排序。</span><button class="text-button" data-action="adjust-priority"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>調整標籤</button></div>'+
      (arr(r.excluded).length ? '<details class="notice"><summary>已排除 '+r.excluded.length+' 家'+(state.conditions.exclude_recent_partner ? '（近一年合作過）' : '')+'</summary>'+r.excluded.map(x => '<p>'+esc(x.name)+' · '+esc(x.reason)+'</p>').join('')+'</details>' : '')+
      (candidates.length ? '<div id="candidate-list">'+candidates.map((c, i) => candidateCard(c,i,maxScore)).join('')+'</div>' : empty('沒有符合的組織，試試放寬條件', '可以減少議題或區域限制，再試一次.'));
  }

  function feedbackWorkspace() {
    const entries = [...new Map(feedback.map(item => [item.org_id, item])).values()].reverse();
    return '<details class="workspace-feedback"><summary>團隊決策清單 <span class="badge green">'+feedback.length+' 筆</span></summary>'+
      '<div class="workspace-feedback-body"><p class="body-copy">逐家確認要保留或暫不邀請，並指定主要推薦原因。</p>'+
      (entries.length ? '<div class="feedback-inline-list">'+entries.map(item => '<div class="feedback-inline-item decision-item"><div><button class="text-button decision-org" data-detail="'+esc(item.org_id)+'">'+esc(orgById(item.org_id)?.name || item.org_id)+'</button><span class="badge '+(item.verdict === '符合' ? 'green' : 'amber')+'">'+(item.verdict === '符合' ? '要' : '不要')+'</span><p>主要推薦原因：'+esc(item.primary_label || '尚未指定')+(item.tags?.length ? ' · 新增標籤：'+esc(arr(item.tags).join('、')) : '')+'</p></div><button class="text-button" data-discuss="'+esc(item.org_id)+'">加入討論</button></div>').join('')+'</div>' : '<p class="muted">尚未留下決策，先在候選卡上選擇「符合」或「不符合」。</p>')+
      '</div></details>';
  }
  function selectOrg(id, record = null) {
    state.selected = id; state.focusRecord = record;
    if (state.step === 2) {
      renderDetail();
      $('#step-3').hidden = false;
      $('#step-3').classList.add('side-detail-open');
      document.body.classList.add('inline-detail-open');
      return;
    }
    go(3);
  }
  function closeInlineDetail() {
    const scrollY = window.scrollY;
    $('#step-3').hidden = true;
    $('#step-3').classList.remove('side-detail-open');
    document.body.classList.remove('inline-detail-open');
    window.scrollTo({top:scrollY, behavior:'auto'});
  }
  function labelReview(org) {
    const overallKey = org.id+'|overall';
    const overall = votes[overallKey];
    const note = votes[org.id+'|note'] || '';
    const details = overall === 'disagree' ? '<div class="label-review-details"><p class="body-copy">請只勾選你覺得不對的判讀，再留一句話。</p><div class="label-review-list">'+arr(org.hits).map(hit => '<label><input type="checkbox" data-label-rule="'+esc(hit.rule)+'" data-label-name="'+esc(hit.label)+'" '+(votes[org.id+'|'+hit.rule] === 'disagree' ? 'checked' : '')+'> <span>'+esc(hit.label)+' <small class="rule">'+esc(hit.rule)+'</small></span></label>').join('')+'</div><label for="label-review-by">編輯人</label><select id="label-review-by">'+personOptions()+'</select><label for="label-review-note">刪除原因</label><textarea id="label-review-note" maxlength="500" placeholder="例如：這個標籤只代表一位窗口的想法，還不能代表整個組織。">'+esc(note)+'</textarea><div class="actions"><button type="button" class="primary" data-action="save-label-review">記下這次確認</button></div></div>' : '';
    return '<div class="label-review"><div class="label-review-heading"><div><strong>這個判讀對嗎？</strong><p class="body-copy">不用逐條回覆；只有不對的地方才需要標出來。</p></div><div class="label-review-actions"><button type="button" class="small-button '+(overall === 'agree' ? 'secondary' : '')+'" data-label-review="agree" aria-pressed="'+(overall === 'agree')+'">大致正確</button><button type="button" class="small-button '+(overall === 'disagree' ? 'secondary' : '')+'" data-label-review="disagree" aria-pressed="'+(overall === 'disagree')+'">有不對的地方</button></div></div>'+details+(overall === 'agree' ? '<p class="label-review-saved">已記下：整體判讀大致正確</p>' : '')+'</div>';
  }
  function renderDetail() {
    const el = $('#step-3');
    if (!state.selected) { el.innerHTML = heading('03', '理解組織，讓邀請更到位', '選一個組織，看看它一路走來的脈絡。')+empty('想先認識哪一家？', '從候選名單點選「看組織詳情」，或從下方選擇組織。', 'back-results', '回到候選名單')+'<div class="panel" style="margin-top:20px"><label for="org-picker">選擇組織</label>'+orgPicker()+'</div>'; return; }
    const org = orgById(state.selected);
    if (!org) { el.innerHTML = empty('暫時找不到這家組織', '請回到名單選擇另一家。','back-results','回到候選名單'); return; }
    const stats = org.stats || {};
    const cited = new Set(arr(org.hits).flatMap(h => arr(h.evidence).map(e => e.record_id)));
    const orgFeedback = feedback.filter(f => f.org_id === org.id);
    const detailClose = state.step === 2
      ? '<button class="secondary" data-action="close-inline-detail">關閉</button>'
      : '<button class="secondary" data-step="2"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>回候選名單</button>';
    el.innerHTML = heading('03', esc(org.name), '把欄位、接觸紀錄與團隊經驗放在一起，邀請前多理解一點。', detailClose)+
      '<div class="detail-layout"><div class="detail-main"><div class="panel summary-card"><h2>30 秒摘要</h2><ul>'+arr(org.summary_30s).map(s => '<li>'+esc(s)+'</li>').join('')+'</ul></div><div class="panel"><h2>系統判讀的標籤</h2><p class="body-copy">這個判讀符合你認識的組織嗎？點開依據，再留下你的確認。</p>'+ (arr(org.hits).length ? org.hits.map((hit, i) => '<article class="hit"><div class="hit-top"><div><span class="badge '+(hit.kind === 'warning' ? 'amber' : 'green')+'">'+esc(hit.label)+'</span><span class="rule">'+esc(hit.rule)+'</span></div><small class="muted">'+esc({ai:'AI 讀文字',keyword:'關鍵字',structured:'結構化欄位'}[hit.method] || '資料判讀')+'</small></div><div>'+evidenceButtons(hit.evidence, org.id)+'</div><div class="vote-actions"><button class="small-button" data-vote="agree" data-hit="'+i+'" aria-pressed="'+(votes[org.id+'|'+hit.rule] === 'agree')+'">認同</button><button class="small-button" data-vote="disagree" data-hit="'+i+'" aria-pressed="'+(votes[org.id+'|'+hit.rule] === 'disagree')+'">不認同</button>'+(votes[org.id+'|'+hit.rule] ? '<small class="muted">已記下你的確認</small>' : '')+'</div></article>').join('') : '<p class="body-copy">目前還沒有足夠資料產生標籤。</p>')+'</div><div class="panel"><h2>一路走來的接觸紀錄</h2><p class="body-copy">新到舊排列 · <span class="badge green">接觸紀錄</span> <span class="badge amber">顧問筆記</span></p><div class="timeline">'+arr(org.timeline).slice().sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).map(t => '<article id="record-'+esc(t.id)+'" class="timeline-item '+(t.kind === 'note' ? 'note' : '')+(state.focusRecord === t.id ? ' highlight' : '')+'"><time>'+esc(t.date || '日期未提供')+'</time> <span class="badge '+(t.kind === 'note' ? 'amber' : 'green')+'">'+esc(t.type || (t.kind === 'note' ? '顧問筆記' : '接觸紀錄'))+'</span> '+(cited.has(t.id) ? '<span class="badge">已引用為依據</span>' : '')+'<h3>'+esc(t.activity || t.type)+'</h3><p>'+esc(t.text)+'</p>'+(t.org_guess ? '<div class="notice">'+esc(t.org_guess)+'</div>' : '')+'<small class="muted">'+esc(t.source || '來源未提供')+' · '+esc(t.id)+'</small></article>').join('')+'</div></div></div><aside class="detail-side"><div class="panel"><h2>組織基本資料</h2><dl class="field-grid">'+Object.entries(org.fields || {}).map(([key, value]) => '<div><dt>'+esc(key)+'</dt><dd class="'+(value == null || value === '' ? 'missing' : '')+'">'+esc(display(value))+'</dd></div>').join('')+'</dl></div><div class="panel"><h2>接觸足跡</h2><div class="stat-cards"><div><b>'+esc(stats.contacts ?? 0)+'</b><small>接觸紀錄</small></div><div><b>'+esc(stats.notes ?? 0)+'</b><small>顧問筆記</small></div></div><small class="muted">最近接觸日</small><p>'+esc(stats.last_contact || '尚無紀錄')+'</p><div class="inline-list">'+Object.entries(stats.by_type || {}).map(([type, n]) => '<span>'+esc(type)+' '+esc(n)+' 次</span>').join('')+'</div><p class="body-copy">資料來源系統</p><div class="org-tags">'+arr(stats.sources || [...new Set(arr(org.timeline).map(t => t.source).filter(Boolean))]).map(s => '<span class="badge">'+esc(s)+'</span>').join('')+'</div></div><div class="panel"><h2>這家的 PM 回饋</h2>'+ (orgFeedback.length ? orgFeedback.map(f => '<div class="hit"><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span> <small>'+esc(arr(f.reason_code).join('、'))+'</small><p>'+esc(f.note || '未填寫備註')+'</p><small class="muted">'+esc(f.date)+' · 判斷人：'+esc(f.by || 'PM')+'</small></div>').join('') : '<p class="body-copy">還沒有回饋。你的判斷會留在這家組織的脈絡裡。</p>')+'</div>'+labelHistoryPanel(org.id)+'</aside></div>';
    const labelPanel = [...el.querySelectorAll('.panel')].find(panel => panel.querySelector('.hit'));
    if (labelPanel) {
      labelPanel.querySelectorAll('.vote-actions').forEach(actions => actions.remove());
      const labelIntro = labelPanel.querySelector('.body-copy');
      if (labelIntro) labelIntro.textContent = '先看依據，再一次回報整體判讀；只有不對的地方才需標出。';
      labelPanel.insertAdjacentHTML('beforeend', labelReview(org));
    }
    if (state.focusRecord) requestAnimationFrame(() => document.getElementById('record-'+state.focusRecord)?.scrollIntoView({block:'center',behavior:'smooth'}));
  }
  function orgPicker() {
    return '<select id="org-picker" class="org-picker"><option value="">請選擇組織</option>'+orgs.map(o => '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join('')+'</select>';
  }
  function removeFeedback(index) { const f = feedback[index]; if (!f) return; deleted.add(feedbackKey(f)); feedback.splice(index,1); persist(); if(state.result) rerank(); renderFeedback(); if (state.step === 2) renderResults(); }
  function renderFeedback() {
    const el = $('#step-4');
    el.innerHTML = heading('04', '把你的經驗，留給下一位夥伴', '每一筆「符合」或「不符合」，都是團隊下次選擇的起點。')+
      '<div class="notice">回饋會寫回組織檔，下一位 PM 也看得到（資料跟著組織走）。<br><small>目前先保存在這台瀏覽器；下載並匯入共用資料後，團隊才能一起看見。</small></div>'+
      (feedback.length ? '<div class="panel"><div class="section-label"><h2>PM 回饋紀錄</h2><span class="badge green">'+feedback.length+' 筆</span></div><div class="table-wrap feedback-table"><table><thead><tr><th>組織</th><th>判斷</th><th>原因與備註</th><th>日期</th><th>操作</th></tr></thead><tbody>'+feedback.map((f,i) => '<tr><td><button class="text-button" data-detail="'+esc(f.org_id)+'">'+esc(orgById(f.org_id)?.name || f.org_id)+'</button></td><td><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span></td><td>'+esc(arr(f.reason_code).join('、') || '—')+'<p class="muted">'+esc(f.note)+'</p>'+(arr(f.tags).length ? '<div class="org-tags">'+arr(f.tags).map(tag => '<span class="badge green">'+esc(tag)+'</span>').join('')+'</div>' : '')+'</td><td>'+esc(f.date)+'<br><small class="muted">'+esc(f.by || 'PM')+'</small></td><td><button class="text-button danger" data-remove="'+i+'">刪除</button></td></tr>').join('')+'</tbody></table></div><div class="feedback-mobile">'+feedback.map((f,i) => '<article class="feedback-entry"><h3>'+esc(orgById(f.org_id)?.name || f.org_id)+'</h3><p><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span> '+esc(arr(f.reason_code).join('、'))+'</p><p>'+esc(f.note || '未填寫備註')+'</p>'+(arr(f.tags).length ? '<div class="org-tags">'+arr(f.tags).map(tag => '<span class="badge green">'+esc(tag)+'</span>').join('')+'</div>' : '')+'<div class="row"><small class="muted">'+esc(f.date)+'</small><button class="text-button danger" data-remove="'+i+'">刪除</button></div></article>').join('')+'</div></div>' : empty('你的第一筆回饋，會讓名單更好', '回到候選名單，替組織標記「符合」或「不符合」。','back-results','回候選名單'))+
      '<div class="panel"><h2>把判斷帶回團隊</h2><p class="body-copy">下載回饋檔，請負責資料的夥伴放到 data/feedback/ 資料夾，再重新整理組織資料（build）。下次打開就能接著使用。</p><div class="actions"><button class="secondary" data-action="download" '+(!feedback.length ? 'disabled' : '')+'><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>下載回饋檔</button><button class="primary" data-action="rerank" '+(!state.result ? 'disabled' : '')+'>依回饋重排名單 <svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button></div><p class="storage-note">'+(storageAvailable ? '回饋已保存在此瀏覽器，下載檔案可交給團隊接續使用。' : '此瀏覽器無法保存回饋；關閉頁面前，請先下載回饋檔。')+'</p></div>';
  }
  function saveFeedback(id, verdict, reason = '', note = '', by = 'PM', tags = [], primaryLabel = '') {
    tags = tags.length ? tags : arr($('#feedback-dialog')?.dataset.noteTag).filter(Boolean);
    const item = runEngine(() => Engine.feedbackItem(id,verdict,reason,note,by,tags,primaryLabel));
    if (!item) return;
    const key = feedbackKey(item);
    if (feedback.some(f => feedbackKey(f) === key)) { toast('這筆回饋已經記下了。'); return; }
    deleted.delete(key); feedback.push(item); persist();
    item.tag_kinds = Object.fromEntries(tags.map(tag => [tag, verdict === '不符合' ? 'hesitation' : 'positive']));
    feedback[feedback.indexOf(item)] = item;
    persist();
    tags.forEach(tag => recordLabelEdit(id, 'add', tag, by, '', verdict === '不符合' ? 'hesitation' : 'positive'));
    if (state.result) rerank(); renderResults(); toast(verdict === '不符合' ? '已留下回饋，這家組織已移到名單最後。' : '已記下：這家組織符合本次需求。');
  }
  function openFeedback(id) {
    const dialog = $('#feedback-dialog');
    dialog.innerHTML = '<form id="negative-form"><div class="dialog-top"><h2 id="feedback-title">哪裡不符合這次需求？</h2><button type="button" data-action="close-feedback" aria-label="關閉回饋視窗"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg></button></div><p class="body-copy">'+esc(orgById(id)?.name || id)+'<br>這家會保留在名單最後，讓判斷有跡可循。</p><label for="feedback-by">留言人</label><select id="feedback-by" required><option value="">請選擇留言人</option>'+personOptions()+'</select><div id="new-person-entry" class="new-person-entry" hidden><label for="new-feedback-person">新留言人姓名</label><div class="inline-fields"><input id="new-feedback-person" maxlength="30" placeholder="例如：王小明"><button type="button" class="secondary small-button" data-person-action="cancel">取消</button><button type="button" class="primary small-button" data-person-action="add">加入</button></div></div><fieldset class="feedback-reason-field"><legend>主要原因 <small>可複選</small></legend><div class="feedback-reasons" role="group" aria-label="主要原因">'+reasonEntries.map(([key, item]) => '<button type="button" class="chip feedback-reason-chip" data-feedback-reason="'+esc(key)+'" aria-pressed="false" title="'+esc(item.hint || '')+'">'+esc(key)+'</button>').join('')+'</div><p id="reason-hint" class="body-copy"></p></fieldset><label for="feedback-note">留一句話，讓同事理解你的判斷</label><textarea id="feedback-note" required maxlength="500" placeholder="例如：團隊剛換主管，先等交接穩定再邀請。"></textarea><div id="note-tag-prompt" class="note-tag-prompt" hidden aria-live="polite"></div><div class="actions"><button type="button" data-action="close-feedback">先取消</button><button type="submit" class="primary">送出回饋並重排</button></div></form>';
    dialog.dataset.org = id; dialog.dataset.noteTag = ''; dialog.showModal(); $('#feedback-by').focus();
  }
  function openPositiveFeedback(id) {
    const dialog = $('#feedback-dialog');
    const org = orgById(id);
    const labels = arr(org?.hits);
    dialog.innerHTML = '<form id="positive-form"><div class="dialog-top"><h2 id="feedback-title">為什麼要保留這家？</h2><button type="button" data-action="close-feedback" aria-label="關閉回饋視窗"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg></button></div><p class="body-copy">'+esc(org?.name || id)+'<br>請指定名單最先呈現的推薦標籤，讓下一位夥伴先看到重點。</p><label for="feedback-by">留言人</label><select id="feedback-by" required><option value="">請選擇留言人</option>'+personOptions()+'</select><div id="new-person-entry" class="new-person-entry" hidden><label for="new-feedback-person">新留言人姓名</label><div class="inline-fields"><input id="new-feedback-person" maxlength="30" placeholder="例如：王小明"><button type="button" class="secondary small-button" data-person-action="cancel">取消</button><button type="button" class="primary small-button" data-person-action="add">加入</button></div></div><label for="positive-label">主要參考的推薦標籤</label><select id="positive-label" required><option value="">請選擇一項推薦標籤</option>'+labels.map(hit => '<option value="'+esc(hit.label)+'">'+esc(hit.label)+'</option>').join('')+'</select><label for="positive-tag">想新增的標籤 <small>選填</small></label><input id="positive-tag" maxlength="80" placeholder="例如：適合第一批合作"><label for="positive-note">補充一句話 <small>選填</small></label><textarea id="positive-note" maxlength="500" placeholder="例如：主管願意親自參與，適合先邀請。"></textarea><div class="actions"><button type="button" data-action="close-feedback">先取消</button><button type="submit" class="primary">加入「要」清單</button></div></form>';
    dialog.dataset.org = id; dialog.dataset.noteTag = ''; dialog.showModal(); $('#feedback-by').focus();
  }
  function findRecord(id) {
    for (const org of orgs) { const record = arr(org.timeline).find(t => t.id === id); if (record) return {org,record}; }
    return null;
  }
  function evidenceRecord(id, orgId) {
    const found = findRecord(id);
    const expected = orgById(orgId);
    const evidence = arr(expected?.hits).flatMap(h => arr(h.evidence)).find(e => e.record_id === id);
    return {found, expected, record: found?.record || evidence, evidence};
  }
  function positionEvidencePopover(button) {
    const popover = $('#evidence-popover');
    const rect = button.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const estimatedHeight = popover.offsetHeight || 210;
    const top = rect.bottom + 10 + estimatedHeight <= window.innerHeight
      ? rect.bottom + 10
      : Math.max(12, rect.top - estimatedHeight - 10);
    popover.style.width = width+'px';
    popover.style.left = left+'px';
    popover.style.top = top+'px';
  }
  function showEvidencePopover(button) {
    clearTimeout(hoverEvidenceTimer);
    const {found, expected, record} = evidenceRecord(button.dataset.evidence,button.dataset.org);
    const popover = $('#evidence-popover');
    if (!record) { popover.hidden = true; return; }
    popover.innerHTML = '<div class="evidence-popover-top"><strong>原始紀錄 '+esc(button.dataset.evidence)+'</strong><span class="badge '+(record.kind === 'note' ? 'amber' : 'green')+'">'+esc(record.type || '接觸紀錄')+'</span></div><p class="evidence-popover-meta">'+esc(record.date || '日期未提供')+' · '+esc(record.activity || record.type || '活動未提供')+'</p><p class="evidence-popover-text">'+esc(record.text || record.quote || '')+'</p><button class="text-button small-button" data-record-detail="'+esc(found?.org.id || expected?.id || button.dataset.org)+'" data-record="'+esc(button.dataset.evidence)+'">開啟完整接觸歷程 <svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>';
    popover.hidden = false;
    positionEvidencePopover(button);
  }
  function hideEvidencePopover(immediate = false) {
    clearTimeout(hoverEvidenceTimer);
    const hide = () => { $('#evidence-popover').hidden = true; };
    if (immediate) hide(); else hoverEvidenceTimer = setTimeout(hide, 180);
  }
  function highlight(text, quote) {
    if (!quote || !text.includes(quote)) return esc(text);
    const index = text.indexOf(quote); return esc(text.slice(0,index))+'<mark>'+esc(quote)+'</mark>'+esc(text.slice(index+quote.length));
  }
  function openEvidence(id, orgId, quote = '') {
    const {found, expected, record, evidence} = evidenceRecord(id, orgId);
    lastDrawerFocus = document.activeElement;
    $('#evidence-drawer').innerHTML = '<div class="drawer-top"><div><p class="body-copy">回到原始依據</p><h2 id="drawer-title">紀錄 '+esc(id)+'</h2></div><button data-action="close-drawer" aria-label="關閉原始紀錄">關閉</button></div>'+
      (record ? '<p class="muted">'+esc(found?.org.name || expected?.name || '')+'</p><dl class="field-grid"><div><dt>日期</dt><dd>'+esc(record.date || '未提供')+'</dd></div><div><dt>接觸類型</dt><dd>'+esc(record.type || '未提供')+'</dd></div><div><dt>來源系統</dt><dd>'+esc(record.source || evidence?.source || '未提供')+'</dd></div><div><dt>活動</dt><dd>'+esc(record.activity || '未提供')+'</dd></div></dl><h3>原始紀錄全文</h3><blockquote>'+highlight(String(record.text || record.quote || ''), quote || evidence?.quote || '')+'</blockquote><p class="body-copy">黃色標示是本次引用的片段。推薦理由仍需搭配整段原文判斷。</p>'+(found && orgId && found.org.id !== orgId ? '<div class="notice error">這筆紀錄屬於另一家組織，不能作為目前組織的依據。</div>' : '')+'<button class="primary" data-record-detail="'+esc(found?.org.id || orgId)+'" data-record="'+esc(id)+'">到組織時間軸看這筆紀錄 <svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>' : '<div class="notice error">找不到這筆紀錄，無法確認原文。請回到回覆內容修正引用。</div>');
    $('#drawer-backdrop').hidden = false; $('#evidence-drawer').hidden = false; document.body.classList.add('overlay-open');
    $('[data-action="close-drawer"]').focus();
  }
  function closeDrawer() {
    $('#drawer-backdrop').hidden = true; $('#evidence-drawer').hidden = true; document.body.classList.remove('overlay-open');
    if (lastDrawerFocus?.isConnected) lastDrawerFocus.focus();
  }
  function availablePriorityLabels() {
    return [...new Set(arr(state.result?.candidates).flatMap(candidate => [
      ...arr(candidate.reasons).map(item => item.label),
      ...arr(candidate.warnings).map(item => item.label)
    ]).filter(Boolean))];
  }
  function renderPriorityModal(labels) {
    const dialog = $('#feedback-dialog');
    const selected = state.priorityLabels;
    dialog.innerHTML = '<form id="priority-form"><div class="dialog-top"><h2 id="feedback-title">先決定要看什麼</h2><button type="button" data-action="close-feedback" aria-label="關閉標籤排序視窗"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg></button></div><p class="body-copy">請依序點選最想先看到的推薦標籤，推薦名單會把它們固定顯示在每家組織上方。</p><div class="priority-picked">'+(selected.length ? selected.map((label, index) => '<span class="priority-picked-item"><b>'+(index+1)+'</b>'+esc(label)+'</span>').join('') : '<span class="muted">尚未選擇，請從下方開始。</span>')+'</div><div class="priority-options">'+labels.map(label => '<button type="button" class="chip '+(selected.includes(label) ? 'selected' : '')+'" data-priority-label="'+esc(label)+'" aria-pressed="'+selected.includes(label)+'" '+(selected.includes(label) ? 'disabled' : '')+'>'+esc(label)+'</button>').join('')+'</div><div class="actions"><button type="button" data-action="close-feedback">取消</button><button type="submit" class="primary" '+(!selected.length ? 'disabled' : '')+'>套用排序並查看名單</button></div></form>';
  }
  function openPriorityModal() {
    const labels = availablePriorityLabels();
    if (!labels.length) { state.priorityLabels = []; go(2); return; }
    state.priorityLabels = [];
    renderPriorityModal(labels);
    const dialog = $('#feedback-dialog');
    dialog.dataset.priorityLabels = JSON.stringify(labels);
    dialog.showModal();
  }
  function discussionLabels(orgId) {
    const org = orgById(orgId);
    return [...new Set([
      ...arr(org?.hits).map(hit => hit.label),
      ...feedback.filter(item => item.org_id === orgId).flatMap(item => [
        item.primary_label, ...arr(item.reason_code), ...arr(item.tags)
      ]),
      ...discussions.filter(item => item.org_id === orgId).flatMap(item => arr(item.tags))
    ].filter(Boolean))];
  }
  function openDiscussion(id) {
    const dialog = $('#feedback-dialog');
    const org = orgById(id);
    const labels = discussionLabels(id);
    const orgFeedback = feedback.filter(item => item.org_id === id).slice().reverse();
    const orgDiscussions = discussions.filter(item => item.org_id === id).slice().reverse();
    const records = [
      ...orgFeedback.map(item => '<article class="discussion-record"><div><span class="badge '+(item.verdict === '符合' ? 'green' : 'amber')+'">'+esc(item.verdict)+'</span><strong>'+esc(item.by || 'PM')+'</strong><small class="muted">'+esc(item.date || '')+'</small></div><p>主要推薦原因：'+(item.primary_label ? signalBadge(item.primary_label, item.tag_kinds?.[item.primary_label] || (item.verdict === '不符合' ? 'hesitation' : 'positive')) : esc(arr(item.reason_code).join('、') || '未指定'))+(arr(item.tags).length ? ' · '+arr(item.tags).map(tag => signalBadge(tag, item.tag_kinds?.[tag] || (item.verdict === '不符合' ? 'hesitation' : 'positive'))).join(' ') : '')+'</p><p class="body-copy">'+esc(item.note || '未填寫意見')+'</p></article>'),
      ...orgDiscussions.map(item => '<article class="discussion-record discussion-opinion"><div><span class="badge blue">討論意見</span><strong>'+esc(item.by || 'PM')+'</strong><small class="muted">'+esc(item.date || '')+'</small></div><p class="body-copy">'+esc(item.note || '未填寫意見')+'</p>'+(arr(item.tags).length ? '<div class="org-tags">'+arr(item.tags).map(tag => signalBadge(tag, item.tag_kind)) .join('')+'</div>' : '')+'</article>')
    ].join('');
    dialog.innerHTML = '<form id="discussion-form"><div class="dialog-top"><h2 id="feedback-title">加入討論</h2><button type="button" data-action="close-feedback" aria-label="關閉加入討論視窗"><svg class="lucide-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg></button></div><p class="body-copy">'+esc(org?.name || id)+'<br>先看系統標籤與團隊判斷，再留下這次討論意見。</p><div class="discussion-section"><h3>目前標籤</h3><div class="org-tags">'+(labels.length ? labels.map(label => signalBadge(label, labelKind(id, label))).join('') : '<span class="muted">目前沒有標籤</span>')+'</div></div><div class="discussion-section"><h3>其他人的判斷</h3><div class="discussion-records">'+(records || '<p class="muted">目前還沒有其他人的判斷。</p>')+'</div></div><label for="discussion-by">留言人</label><select id="discussion-by" required><option value="">請選擇留言人</option>'+personOptions()+'</select><div id="discussion-new-person-entry" class="new-person-entry" hidden><label for="new-discussion-person">新留言人姓名</label><div class="inline-fields"><input id="new-discussion-person" maxlength="30" placeholder="例如：王小明"><button type="button" class="secondary small-button" data-person-action="cancel" data-person-scope="discussion">取消</button><button type="button" class="primary small-button" data-person-action="add" data-person-scope="discussion">加入</button></div></div><label for="discussion-note">這次的討論意見</label><textarea id="discussion-note" required maxlength="500" placeholder="例如：先邀請窗口確認近期人力，再決定是否安排陪跑。"></textarea><label for="discussion-tag">新增標籤 <small>選填</small></label><input id="discussion-tag" maxlength="80" placeholder="例如：需要先確認人力"><label for="discussion-tag-kind">標籤分類</label><select id="discussion-tag-kind"><option value="positive">正向訊號</option><option value="hesitation">猶豫訊號</option></select><div class="actions"><button type="button" data-action="close-feedback">先取消</button><button type="submit" class="primary">保存討論</button></div></form>';
    dialog.dataset.org = id;
    dialog.showModal();
    $('#discussion-by').focus();
  }
  function saveDiscussion(id, by, note, tag, tagKind = 'positive') {
    const item = {org_id:id, by, note, tags:tag ? [tag] : [], tag_kind:tagKind || 'positive', date:new Date().toISOString()};
    discussions.push(item);
    persistDiscussions();
    if (tag) recordLabelEdit(id, 'add', tag, by, '', item.tag_kind);
    renderPrompt();
    if (state.step === 2) renderResults();
    $('#feedback-dialog').close();
    toast(tag ? '已保存討論意見，並新增標籤。' : '已保存討論意見。');
  }
  function reasonSummary(orgId, feedbackItem = null) {
    const candidate = arr(state.result?.candidates).find(item => item.org_id === orgId);
    const positive = [...arr(candidate?.reasons).map(item => item.label)];
    const hesitation = [...arr(candidate?.warnings).map(item => item.label)];
    if (feedbackItem?.primary_label) {
      const target = feedbackItem.verdict === '不符合' ? hesitation : positive;
      if (!target.includes(feedbackItem.primary_label)) target.unshift(feedbackItem.primary_label);
    }
    arr(feedbackItem?.reason_code).forEach(label => {
      if (!hesitation.includes(label)) hesitation.push(label);
    });
    const renderGroup = (title, items, kind, fallback) => '<div class="reason-summary-group '+kind+'"><span class="reason-summary-title">'+title+'</span><div class="reason-summary-items">'+(items.length ? items.slice(0,3).map(label => '<span class="reason-summary-item">'+esc(label)+'</span>').join('') : '<span class="reason-summary-empty">'+fallback+'</span>')+'</div></div>';
    return '<div class="reason-summary">'+renderGroup('主要推薦原因', positive, 'positive', '尚未整理推薦訊號')+renderGroup('猶豫原因', hesitation, 'hesitation', '目前沒有明確猶豫訊號')+'</div>';
  }
  function renderPrompt() {
    const el = $('#step-5');
    if (!state.result || !arr(state.result.candidates).length) { el.innerHTML = heading('05','團隊考慮名單','先產生候選名單，再共同留下判斷依據。')+empty('先準備一份候選名單', '產生名單後，這裡會集中顯示團隊決策與主要推薦原因。','back-results','回候選名單'); return; }
    const entries = feedback.slice().reverse();
    el.innerHTML = heading('05','團隊決策清單','集中查看哪些組織要保留、哪些不要，以及每家主要推薦原因。','<button class="secondary" data-step="2">回考慮名單</button>')+
      '<div class="panel decision-page-panel"><div class="section-label"><h2>團隊選擇與主要推薦原因</h2><span class="badge green">'+entries.length+' 筆決策</span></div><p class="body-copy">由團隊選擇要不要，系統只呈現推薦與猶豫依據，不代替團隊做決定。</p>'+
      (entries.length ? '<div class="decision-page-list">'+entries.map(item => '<article class="decision-page-item"><div class="decision-page-main"><div class="decision-org-block"><button class="text-button decision-org" data-detail="'+esc(item.org_id)+'">'+esc(orgById(item.org_id)?.name || item.org_id)+'</button>'+reasonSummary(item.org_id, item)+(arr(item.tags).length ? '<div class="org-tags">'+arr(item.tags).map(tag => signalBadge(tag, item.tag_kinds?.[tag] || (item.verdict === '不符合' ? 'hesitation' : 'positive'))).join('')+'</div>' : '')+(item.note ? '<p class="body-copy">'+esc(item.note)+'</p>' : '')+'</div></div><div class="decision-page-actions"><select class="decision-select" data-decision-org="'+esc(item.org_id)+'" aria-label="選擇 '+esc(orgById(item.org_id)?.name || item.org_id)+' 要不要"><option value="要" '+(item.verdict === '符合' ? 'selected' : '')+'>要</option><option value="不要" '+(item.verdict === '不符合' ? 'selected' : '')+'>不要</option></select><small class="muted">'+esc(item.by || 'PM')+' · '+esc(item.date || '')+'</small><button class="text-button" data-discuss="'+esc(item.org_id)+'">加入討論</button></div></article>').join('') : '<div class="empty"><h2>還沒有團隊決策</h2><p>回到考慮名單，替每家組織選擇要不要。</p><button class="primary" data-step="2">回考慮名單</button></div>')+'</div>';
  }
  function renderVerification() {
    const el = $('#verification-results'); if (!el) return;
    const v = state.verified;
    if (!v) { el.innerHTML = ''; return; }
    const items = arr(v.items), bad = items.filter(item => item.status !== 'ok');
    // 依每行的驗證項目依序標色，避免同一筆紀錄在不同組織下被誤標為正確。
    const used = new Set();
    const rendered = state.reply.split('\n').map((line, lineIndex) => {
      const regex = /\b[A-Z]{1,3}\d+\b/g; let out = '', from = 0, match;
      while ((match = regex.exec(line))) {
        const sameLine = items.findIndex((item, i) => !used.has(i) && item.record_id === match[0] && (typeof item.line === 'string' && item.line.includes(match[0]) && item.line.trim() === line.trim() || typeof item.line === 'number' && (item.line === lineIndex+1)));
        const index = sameLine >= 0 ? sameLine : items.findIndex((item,i) => !used.has(i) && item.record_id === match[0]);
        const item = index >= 0 ? items[index] : null; if (item) used.add(index);
        out += esc(line.slice(from,match.index))+'<button class="'+(item?.status === 'ok' ? 'citation-ok' : 'citation-bad')+'" data-evidence="'+esc(match[0])+'" data-org="'+esc(item?.org_id || '')+'">'+esc(match[0])+'</button>'; from = regex.lastIndex;
      }
      return out+esc(line.slice(from));
    }).join('\n');
    el.innerHTML = '<div class="verification-summary"><span>'+esc(v.ok_count)+' 筆引用正確</span><span class="bad">'+esc(v.bad_count)+' 筆有問題</span></div>'+
      (!items.length ? '<div class="notice warning">沒有找到可檢查的引用。請保留組織編號與紀錄編號，再檢查一次。</div>' : '')+
      bad.map(item => '<div class="verification-problem">'+esc(item.org_id || '組織未標明')+' · <button class="evidence-button" data-evidence="'+esc(item.record_id)+'" data-org="'+esc(item.org_id)+'">'+esc(item.record_id)+'</button> '+(item.status === 'wrong_org' ? '這筆紀錄不屬於這家組織' : '找不到這筆紀錄')+'</div>').join('')+
      '<h3 style="margin-top:18px">回覆內容與引用標記</h3><p class="body-copy">綠色：引用核對通過 · 紅色：需修正或尚無法確認。點編號看原文。</p><div class="reply-render">'+rendered+'</div>';
  }
  document.addEventListener('input', event => {
    if (event.target.id === 'sentence') state.sentence = event.target.value;
    if (event.target.id === 'reply-text') { state.reply = event.target.value; state.verified = null; renderVerification(); }
    if (event.target.id === 'feedback-note') {
      const note = event.target.value.trim();
      const prompt = $('#note-tag-prompt');
      const dialog = $('#feedback-dialog');
      if (!note) { prompt.hidden = true; dialog.dataset.noteTag = ''; return; }
      if (dialog.dataset.noteTag && dialog.dataset.noteTag !== note) dialog.dataset.noteTag = '';
      prompt.hidden = false;
      prompt.classList.toggle('is-added', dialog.dataset.noteTag === note);
      prompt.innerHTML = dialog.dataset.noteTag === note
        ? '<span class="tag-success">已加入標籤</span><span class="badge green">'+esc(note)+'</span><button type="button" class="text-button small-button" data-note-tag-action="cancel">取消加入</button>'
        : '<span>要把這句話加入這家組織的標籤嗎？</span><button type="button" class="secondary small-button" data-note-tag-action="cancel">先不要</button><button type="button" class="primary small-button" data-note-tag-action="add">加入標籤</button>';
    }
    if (['need-n','multiplier'].includes(event.target.id)) $('#estimate').textContent = '將列出 '+((Number($('#need-n').value)||0)*(Number($('#multiplier').value)||0))+' 家候選';
  });
  document.addEventListener('change', event => {
    if (event.target.dataset.decisionOrg) {
      if (event.target.value === '要') openPositiveFeedback(event.target.dataset.decisionOrg);
      if (event.target.value === '不要') openFeedback(event.target.dataset.decisionOrg);
      return;
    }
    if (event.target.id === 'org-picker' && event.target.value) selectOrg(event.target.value);
    if (['feedback-by', 'discussion-by'].includes(event.target.id)) {
      const prefix = event.target.id === 'discussion-by' ? 'discussion-' : '';
      const entry = $('#'+prefix+'new-person-entry');
      const isNew = event.target.value === '__new__';
      if (entry) entry.hidden = !isNew;
      if (isNew) $('#new-'+prefix+'person')?.focus();
    }
    if (event.target.dataset.feedbackReason) {
      const selected = [...document.querySelectorAll('[data-feedback-reason][aria-pressed="true"]')].map(button => button.dataset.feedbackReason);
      $('#reason-hint').textContent = selected.map(reason => settings.feedback_reasons?.[reason]?.hint).filter(Boolean).join('；');
    }
    if (event.target.dataset.labelRule && state.selected) {
      const key = state.selected+'|'+event.target.dataset.labelRule;
      if (event.target.checked) votes[key] = 'disagree'; else delete votes[key];
      write(VOTES,votes);
    }
  });
  document.addEventListener('submit', event => {
    if (!['negative-form', 'positive-form', 'priority-form', 'discussion-form'].includes(event.target.id)) return; event.preventDefault();
    if (event.target.id === 'priority-form') {
      if (!state.priorityLabels.length) { toast('請至少選擇一個推薦標籤。'); return; }
      $('#feedback-dialog').close(); go(2); return;
    }
    if (event.target.id === 'positive-form') {
      const by = $('#feedback-by').value;
      const primary = $('#positive-label').value;
      const customTag = $('#positive-tag').value.trim();
      const note = $('#positive-note').value.trim();
      if (!by || !primary) { toast('請選擇留言人與主要參考標籤。'); return; }
      saveFeedback($('#feedback-dialog').dataset.org, '符合', primary, note, by, customTag ? [customTag] : [], primary);
      $('#feedback-dialog').close();
      return;
    }
    if (event.target.id === 'discussion-form') {
      const by = $('#discussion-by').value;
      const note = $('#discussion-note').value.trim();
      const tag = $('#discussion-tag').value.trim();
      const tagKind = $('#discussion-tag-kind').value;
      if (!by) { toast('請選擇留言人。'); return; }
      if (!note) { toast('請留下這次的討論意見。'); $('#discussion-note').focus(); return; }
      saveDiscussion($('#feedback-dialog').dataset.org, by, note, tag, tagKind);
      return;
    }
    const reasons = [...document.querySelectorAll('[data-feedback-reason][aria-pressed="true"]')].map(button => button.dataset.feedbackReason);
    const note = $('#feedback-note').value.trim();
    if (!reasons.length) { toast('請至少選一個主要原因。'); return; }
    if (!note) { $('#feedback-note').setCustomValidity('請留一句話說明原因。'); $('#feedback-note').reportValidity(); $('#feedback-note').setCustomValidity(''); return; }
    saveFeedback($('#feedback-dialog').dataset.org,'不符合',reasons,note,$('#feedback-by').value); $('#feedback-dialog').close();
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.step) { go(button.dataset.step); return; }
    if (button.dataset.demand != null) {
      const d = demands[Number(button.dataset.demand)]; state.sentence = d.sentence;
      state.conditions = clone(d.conditions); state.conditions._matched = ['已帶入「'+d.title+'」示範需求的條件，可自由調整'];
      renderInput(); toast('已帶入示範需求與條件。'); return;
    }
    if (button.dataset.chip) {
      if (!collectConditions()) return;
      const field = button.dataset.chip, value = button.dataset.value;
      const target = field === 'soft' ? state.conditions : state.conditions.hard, key = field;
      const selected = arr(target[key]); target[key] = selected.includes(value) ? selected.filter(v => v !== value) : [...selected,value]; renderConditions(); return;
    }
    if (button.dataset.feedbackReason) {
      const selected = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!selected));
      button.classList.toggle('selected', !selected);
      const reasons = [...document.querySelectorAll('[data-feedback-reason][aria-pressed="true"]')].map(item => settings.feedback_reasons?.[item.dataset.feedbackReason]?.hint).filter(Boolean);
      $('#reason-hint').textContent = reasons.join('；');
      return;
    }
    if (button.dataset.noteTagAction) {
      const prompt = $('#note-tag-prompt');
      if (button.dataset.noteTagAction === 'add') {
        const note = $('#feedback-note').value.trim();
        $('#feedback-dialog').dataset.noteTag = note;
        prompt.innerHTML = '<span class="tag-success">已加入標籤</span><span class="badge green">'+esc(note)+'</span><button type="button" class="text-button small-button" data-note-tag-action="cancel">取消加入</button>';
        prompt.classList.add('is-added');
      } else {
        $('#feedback-dialog').dataset.noteTag = '';
        prompt.innerHTML = '<span>已取消加入標籤，這句話仍會保留在回饋中。</span>';
        prompt.classList.remove('is-added');
      }
      return;
    }
    if (button.dataset.personAction) {
      const isDiscussion = button.dataset.personScope === 'discussion';
      const prefix = isDiscussion ? 'discussion-' : '';
      const entry = $('#'+prefix+'new-person-entry');
      const select = $('#'+prefix+'by');
      if (button.dataset.personAction === 'cancel') {
        entry.hidden = true; select.value = '';
        return;
      }
      const name = $('#new-'+prefix+'person').value.trim();
      if (!name) { toast('請輸入留言人姓名。'); $('#new-feedback-person').focus(); return; }
      if (!people.includes(name)) { people.push(name); write(PEOPLE, people); }
      select.innerHTML = '<option value="">請選擇留言人</option>'+personOptions(name);
      select.value = name; entry.hidden = true; toast('已新增留言人：'+name); return;
    }
    if (button.dataset.priorityLabel) {
      if (!state.priorityLabels.includes(button.dataset.priorityLabel)) state.priorityLabels.push(button.dataset.priorityLabel);
      renderPriorityModal(JSON.parse($('#feedback-dialog').dataset.priorityLabels || '[]'));
      return;
    }
    if (button.dataset.scenario) {
      if (!collectConditions()) return;
      const scenario = button.dataset.scenario, defaults = settings.scenario_defaults?.[scenario] || {};
      state.conditions.scenario = scenario; state.conditions.multiplier = defaults.multiplier || state.conditions.multiplier; state.conditions.soft = clone(defaults.soft || []); renderConditions(); return;
    }
    if (button.dataset.detail) { selectOrg(button.dataset.detail); return; }
    if (button.dataset.evidence) { openEvidence(button.dataset.evidence,button.dataset.org,button.dataset.quote); return; }
    if (button.dataset.recordDetail) { hideEvidencePopover(true); closeDrawer(); selectOrg(button.dataset.recordDetail,button.dataset.record); return; }
    if (button.dataset.labelReview && state.selected) {
      const org = orgById(state.selected);
      votes[state.selected+'|overall'] = button.dataset.labelReview;
      if (button.dataset.labelReview === 'agree') {
        arr(org?.hits).forEach(hit => delete votes[state.selected+'|'+hit.rule]);
        delete votes[state.selected+'|note'];
      }
      write(VOTES,votes); renderDetail(); return;
    }
    if (button.dataset.verdict) { if (!engineReady()) return; if (button.dataset.verdict === '符合') openPositiveFeedback(button.dataset.org); else openFeedback(button.dataset.org); return; }
    if (button.dataset.discuss) { openDiscussion(button.dataset.discuss); return; }
    if (button.dataset.remove != null) { removeFeedback(Number(button.dataset.remove)); toast('已刪除這筆回饋。'); return; }
    if (button.dataset.vote) {
      const hit = orgById(state.selected)?.hits?.[Number(button.dataset.hit)]; if (!hit) return;
      const key = state.selected+'|'+hit.rule; if (votes[key] === button.dataset.vote) delete votes[key]; else votes[key] = button.dataset.vote;
      write(VOTES,votes); const y = window.scrollY; state.focusRecord = null; renderDetail(); window.scrollTo(0,y); return;
    }
    switch (button.dataset.action) {
      case 'close-inline-detail': closeInlineDetail(); break;
      case 'parse': {
        state.sentence = $('#sentence').value.trim();
        if (!state.sentence) { toast('先寫一句這次的需求，或選一個示範需求。'); $('#sentence').focus(); return; }
        const parsed = runEngine(() => Engine.parseSentence(state.sentence));
        if (parsed) { const example = demands.find(d => d.sentence.trim() === state.sentence); state.conditions = example ? {...clone(parsed), ...clone(example.conditions), _matched:[...arr(parsed._matched).filter(text => !text.includes('預設倍率')), '依示範需求：需要 '+example.conditions.need_n+' 家，先列 '+(example.conditions.need_n*example.conditions.multiplier)+' 家候選']} : clone(parsed); state.conditions.hard ||= {}; state.conditions.soft ||= []; renderConditions(); $('#conditions-form').scrollIntoView({behavior:'smooth',block:'start'}); }
        break;
      }
      case 'rank': if (collectConditions() && rerank()) openPriorityModal(); break;
      case 'rerank': if (state.conditions && rerank()) { go(2); toast('已依 PM 回饋重新排列名單。'); } break;
      case 'back-input': go(1); break;
      case 'back-results': go(2); break;
      case 'close-feedback': $('#feedback-dialog').close(); break;
      case 'adjust-priority': openPriorityModal(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'download': {
        const exported = runEngine(() => Engine.exportFeedback(feedback)); if (typeof exported !== 'string') return;
        const url = URL.createObjectURL(new Blob([exported],{type:'application/json;charset=utf-8'})); const a = document.createElement('a');
        const date = new Date(); const stamp = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('');
        a.href = url; a.download = 'feedback_'+stamp+'.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
        toast('已下載回饋檔，請交給資料夥伴放到 data/feedback/ 後重新 build。'); break;
      }
      case 'copy-prompt': {
        try { await navigator.clipboard.writeText(state.prompt); toast('已複製，貼到 Claude 就能使用。'); }
        catch (_) { const area = $('#prompt-text'); area.focus(); area.select(); toast('已選取提示詞，請按 Ctrl+C（Mac：⌘C）複製。'); }
        break;
      }
      case 'verify': {
        state.reply = $('#reply-text').value.trim(); if (!state.reply) { toast('請先貼上 Claude 的回覆。'); $('#reply-text').focus(); return; }
        const verified = runEngine(() => Engine.verifyReply(state.reply,state.result.candidates)); if (verified) { state.verified = verified; renderVerification(); } break;
      }
      case 'save-label-review': {
        const note = $('#label-review-note')?.value.trim();
        const selectedLabels = document.querySelectorAll('[data-label-rule]:checked');
        const by = $('#label-review-by')?.value || 'PM';
        if (!selectedLabels.length) { toast('請至少標出一條不正確的判讀。'); return; }
        if (!note) { toast('請留一句話說明哪裡需要修正。'); $('#label-review-note')?.focus(); return; }
        selectedLabels.forEach(input => recordLabelEdit(state.selected, 'delete', input.dataset.labelName, by, note));
        votes[state.selected+'|note'] = note; write(VOTES,votes); renderDetail(); toast('已記下這次判讀確認。'); break;
      }
    }
  });
  document.addEventListener('pointerover', event => {
    const button = event.target.closest('.evidence-button');
    if (button) showEvidencePopover(button);
    if (event.target.closest('#evidence-popover')) clearTimeout(hoverEvidenceTimer);
  });
  document.addEventListener('pointerout', event => {
    if (event.target.closest('.evidence-button') || event.target.closest('#evidence-popover')) hideEvidencePopover();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest('.evidence-button');
    if (button) showEvidencePopover(button);
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest('.evidence-button') || event.target.closest('#evidence-popover')) hideEvidencePopover();
  });
  $('#evidence-popover').addEventListener('pointerover', () => clearTimeout(hoverEvidenceTimer));
  $('#evidence-popover').addEventListener('pointerout', hideEvidencePopover);
  $('#drawer-backdrop').addEventListener('click',closeDrawer);
  document.addEventListener('keydown', event => {
    if ($('#evidence-drawer').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
    if (event.key === 'Tab') {
      const focusable = [...$('#evidence-drawer').querySelectorAll('button,a,input,textarea,select')].filter(el => !el.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('.brand').addEventListener('click', event => { event.preventDefault(); go(1); });
  const source = meta.source === 'mock' ? 'mock（展示資料）' : meta.source === 'official' ? 'official（活動資料）' : meta.source || '尚未載入';
  $('#data-meta').innerHTML = '<strong><span class="source-dot"></span>資料來源：'+esc(source)+'</strong><br><span>資料基準 '+esc(meta.ref_date || '未提供')+' · '+orgs.length+' 家組織</span>';
  let notices = '';
  if (!data) notices += '<div class="notice error">組織資料尚未載入，請確認資料檔已準備好後重新整理。</div>';
  if (!window.Engine) notices += '<div class="notice warning">媒合功能準備中。你可以先填需求、試選示範條件；媒合檔準備好後，重新整理即可產生名單。</div>';
  if (!storageAvailable) notices += '<div class="notice warning">這個瀏覽器無法保存操作，離開前請下載回饋檔。</div>';
  if (arr(meta.disabled_rules).length) notices += '<details class="notice warning"><summary>有 '+meta.disabled_rules.length+' 條規則因資料缺欄位停用</summary>'+meta.disabled_rules.map(r => '<p>'+esc(r.id)+'：'+esc(r.reason)+'</p>').join('')+'</details>';
  $('#global-notices').innerHTML = notices;
  if (window.Engine && data) runEngine(() => Engine.init(data));
  renderInput(); go(1);
})();

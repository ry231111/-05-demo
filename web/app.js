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
  let storageAvailable = true;
  function read(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch (_) { storageAvailable = false; return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { storageAvailable = false; toast('已保留本次操作；此瀏覽器無法保存，關閉前請下載回饋。'); }
  }
  const feedbackKey = f => [f.org_id, f.verdict, f.reason_code || '', f.note || '', f.by || '', f.date || ''].join('|');
  const saved = read(STORE, {items:[], deleted:[]});
  const deleted = new Set(arr(saved.deleted));
  const seed = arr(data?.feedback?.items || data?.feedback?.feedback || data?.feedback);
  const feedbackMap = new Map([...seed, ...arr(saved.items)].filter(f => f && f.org_id && !deleted.has(feedbackKey(f))).map(f => [feedbackKey(f), f]));
  let feedback = [...feedbackMap.values()];
  const votes = read(VOTES, {});
  const state = { step:1, sentence:'', conditions:null, result:null, selected:null, reply:'', verified:null, prompt:'', focusRecord:null };
  const orgs = arr(data?.orgs?.orgs);
  const meta = data?.orgs?.meta || {};
  const settings = data?.conditions || {};
  const demands = arr(data?.demands);
  const orgById = id => orgs.find(o => o.id === id);
  const scenarioCopy = {'實驗課':'找願意先試一輪的夥伴','例行課':'找到穩定參與、能落實的組織','企業陪跑':'讓專業支持遇見合適的需求','年度走訪':'先關心最近需要支持的組織'};
  const reasonEntries = Object.entries(settings.feedback_reasons || {}).filter(([key]) => !key.startsWith('_'));
  const softEntries = Object.entries(settings.soft || {}).filter(([key]) => !key.startsWith('_'));
  let lastDrawerFocus = null;
  let toastTimer;
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  function persist() { write(STORE, {items:feedback, deleted:[...deleted]}); }
  function engineReady() {
    if (!window.Engine || !data) { toast(!data ? '組織資料尚未載入，請確認資料檔已準備好。' : '媒合功能尚未載入；請等媒合檔準備好後重新整理。'); return false; }
    return true;
  }
  function runEngine(action) {
    if (!engineReady()) return;
    try { return action(); } catch (error) { console.error(error); toast('這次處理未完成，請確認條件後再試一次。'); }
  }
  function heading(num, title, subtitle, right = '') {
    return '<div class="page-heading"><div><div class="eyebrow">'+num+' / 為計畫找對的組織</div><h1>'+title+'</h1><p class="subtitle">'+subtitle+'</p></div>'+right+'</div>';
  }
  function empty(title, text, action = 'back-input', button = '回到需求輸入') {
    return '<div class="empty"><div class="empty-icon" aria-hidden="true">✳</div><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><button class="primary" data-action="'+action+'">'+esc(button)+'</button></div>';
  }
  function go(step) {
    state.step = Number(step);
    if (state.step === 2) renderResults();
    if (state.step === 3) renderDetail();
    if (state.step === 4) renderFeedback();
    if (state.step === 5) renderPrompt();
    document.querySelectorAll('.page').forEach((el, i) => { el.hidden = i + 1 !== state.step; });
    document.querySelectorAll('[data-step]').forEach(el => {
      const active = Number(el.dataset.step) === state.step;
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
      '<div class="intake-layout"><div><div class="panel intake-panel"><div class="section-label"><span class="number">A</span><h2>這次，想找什麼樣的夥伴？</h2></div><label class="muted" for="sentence">把企業或計畫的一句話需求貼進來</label><textarea id="sentence" class="sentence" placeholder="例如：想找五家北部的兒少組織做行銷陪跑，希望願意嘗試新做法，也能固定回覆作業。">'+esc(state.sentence)+'</textarea><div class="input-footer"><small class="muted">不用先想好條件，照平常說話的方式寫就好。</small><button class="primary" data-action="parse">轉成條件 <span aria-hidden="true">↗</span></button></div><p class="example-label">還沒想好？用一個常見需求開始</p><div class="examples">'+demands.map((d, i) => '<button data-demand="'+i+'">'+esc(d.title)+' <span aria-hidden="true">↗</span></button>').join('')+'</div></div><div id="conditions-form"></div></div><aside class="guide"><div class="guide-symbol" aria-hidden="true">✳</div><h3>少一點翻找，<br>多一點理解。</h3><p>把散落的接觸紀錄接起來，讓你的下一通電話，有更好的起點。</p><ol><li>需求轉成條件，隨時能調整</li><li>每個推薦，都找得到原始依據</li><li>留下回饋，讓團隊接著做</li></ol><div class="guide-note">系統整理線索，<br>你決定誰最適合這次計畫。</div></aside></div>';
    renderConditions();
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
    el.innerHTML = '<div class="panel conditions-panel"><div class="section-label"><span class="number">B</span><h2>確認這次的媒合條件</h2></div><p class="body-copy">這是第一版條件，你可以依照計畫需要再調整。</p>'+ (arr(c._matched).length ? '<div class="notice matched">系統從你的句子讀到：'+arr(c._matched).map(readableMatch).map(esc).join('；')+'</div>' : '')+
      '<div class="form-row"><div class="form-label">這次是什麼計畫？</div><div class="segments">'+Object.entries(scenarioCopy).map(([name, text]) => '<button type="button" class="'+(c.scenario === name ? 'selected' : '')+'" data-scenario="'+esc(name)+'" aria-pressed="'+(c.scenario === name)+'"><strong>'+name+'</strong><small>'+text+'</small></button>').join('')+'</div></div>'+
      '<div class="form-row"><div class="form-label">先找幾家候選？</div><div class="inline-fields"><label>需要 <input id="need-n" type="number" min="1" max="999" value="'+esc(c.need_n)+'"> 家</label><label>候選倍數 <input id="multiplier" type="number" min="1" max="20" value="'+esc(c.multiplier)+'"> 倍</label><span class="estimate" id="estimate">將列出 '+esc(c.need_n * c.multiplier)+' 家候選</span></div></div>'+
      '<div class="form-row"><div class="form-label">議題 <small>可複選；不選代表不限</small></div>'+chipGroup('議題', optionsFor('議題'), hard['議題'])+'</div>'+
      '<div class="form-row"><div class="form-label">區域 <small>可複選；不選代表不限</small></div>'+chipGroup('區域', optionsFor('區域'), hard['區域'])+'</div>'+
      '<div class="form-row"><div class="form-label">全職人數 <small>留空代表不限</small></div><div class="inline-fields"><label>最少 <input id="staff-min" type="number" min="0" value="'+esc(hard['全職人數']?.min)+'"> 人</label><span>—</span><label>最多 <input id="staff-max" type="number" min="0" value="'+esc(hard['全職人數']?.max)+'"> 人</label></div></div>'+
      '<div class="form-row"><div class="form-label">希望組織具備的特質 <small>加分條件，沒有符合也會保留考量</small></div><div class="chips">'+softEntries.map(([name, item]) => '<button type="button" title="'+esc(item.explain)+'" class="chip '+(arr(c.soft).includes(name) ? 'selected' : '')+'" data-chip="soft" data-value="'+esc(name)+'" aria-pressed="'+arr(c.soft).includes(name)+'">'+esc(name)+'</button>').join('')+'</div><div class="explanations">'+softEntries.filter(([name]) => arr(c.soft).includes(name)).map(([name, item]) => '<span>'+esc(name)+'：'+esc(item.explain)+'</span>').join('')+'</div></div>'+
      '<div class="form-row"><label class="switch"><input id="exclude-partner" type="checkbox" '+(c.exclude_recent_partner ? 'checked' : '')+'><span>排除近一年合作過的</span></label><p class="body-copy">近一年已陪跑或獎補助合作的組織，先留給下一次機會。</p></div>'+
      '<details class="form-row"><summary>其他條件與放寬順序</summary>'+extraFields.map(field => '<div class="form-row"><div class="form-label">'+esc(field)+'</div>'+chipGroup(field, optionsFor(field), hard[field])+'</div>').join('')+'<label for="relax-order">名單不足時，依序放寬</label><select id="relax-order">'+['區域,全職人數,議題','全職人數,區域,議題','議題,區域,全職人數'].map(value => '<option value="'+value+'" '+(arr(c.relax_order).join(',') === value ? 'selected' : '')+'>'+value.replaceAll(',', ' → ')+'</option>').join('')+'</select></details>'+
      '<div class="actions"><span class="muted">先有一份名單，再用你的經驗選出好夥伴。</span><button class="primary" data-action="rank">產生候選名單 →</button></div></div>';
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
    let value = String(text || '').replace(/\s*\[[CN]\d+\]/g, '').trim();
    if (label && value.startsWith(label+'：')) value = value.slice(label.length+1);
    return value;
  }
  function reasonColumn(title, list, kind, orgId, fallback) {
    const renderReason = r => {
      const ids = [...new Set((String(r.text || '').match(/\b[CN]\d+\b/g) || []))];
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
    return '<article class="candidate '+(demoted ? 'demoted' : '')+'" data-candidate="'+esc(c.org_id)+'"><div class="candidate-top"><div class="candidate-identity"><span class="rank">'+String(i + 1).padStart(2, '0')+'</span><div><h2>'+esc(c.name)+'</h2><div class="org-tags">'+tagFields.map(key => '<span class="badge">'+esc(display(f[key]))+(key === '全職人數' && f[key] != null ? ' 人' : '')+'</span>').join('')+(c.hard_status === 'relaxed' ? '<span class="badge amber">放寬後納入</span>' : '')+(c.hard_status === 'missing' || arr(c.missing_fields).length ? '<span class="badge amber">資料缺：'+arr(c.missing_fields).map(esc).join('、')+'</span>' : '')+'</div></div></div><div class="score"><small>媒合分數</small><strong>'+esc(Math.round(score * 10) / 10)+'</strong><div class="score-track" role="img" aria-label="媒合分數 '+score+'"><span style="width:'+scoreWidth+'%"></span></div><small>依本次條件排序</small></div></div><div class="candidate-body">'+
      reasonColumn('✓ 為什麼推薦', arr(c.reasons), '', c.org_id, '符合目前條件，可進一步認識。')+
      reasonColumn('⚠ 要注意什麼', arr(c.warnings), 'warning', c.org_id, '目前沒有明確警訊，仍建議電訪確認。')+
      reasonColumn('☎ 電訪先關心什麼', arr(c.call_questions), 'call', c.org_id, '確認參與意願、可投入人力與期待。')+'</div>'+
      (arr(c.soft_matched).length ? '<div class="soft-matches">'+arr(c.soft_matched).map(s => '<span class="badge '+(s.delta < 0 ? 'amber' : 'green')+'" title="'+esc(s.explain)+'">'+(s.delta < 0 ? '⚠ ' : '✓ ')+esc(s.name)+'</span>').join('')+'</div>' : '')+
      '<div class="candidate-footer"><div class="feedback-actions"><span>你的判斷，讓名單更貼近現場</span><button class="small-button '+(latest?.verdict === '符合' ? 'secondary' : '')+'" data-verdict="符合" data-org="'+esc(c.org_id)+'">✓ 符合</button><button class="small-button" data-verdict="不符合" data-org="'+esc(c.org_id)+'">不符合</button></div><button class="text-button small-button" data-detail="'+esc(c.org_id)+'">看組織詳情 ↗</button></div>'+
      (latest ? '<div class="feedback-note"><span>'+(latest.verdict === '符合' ? '✓ PM 認為符合這次需求' : 'PM 判斷不符合 · '+esc(latest.reason_code || '其他'))+(latest.note ? '：'+esc(latest.note) : '')+(demoted ? ' · 已移至名單最後' : '')+'</span><button class="text-button small-button" data-undo="'+esc(c.org_id)+'">撤回</button></div>' : '')+'</article>';
  }
  function renderResults() {
    const el = $('#step-2');
    if (!state.result) { el.innerHTML = heading('02', '找到值得先聊聊的夥伴', '每一個推薦，都能回到原始紀錄。')+empty('先告訴我們，這次想找誰', '輸入需求並確認條件，就能產生第一波候選名單。'); return; }
    const r = state.result, candidates = arr(r.candidates);
    const maxScore = Math.max(1, ...candidates.map(c => Number(c.score) || 0));
    const disabled = arr(r.disabled_rules);
    el.innerHTML = heading('02', '這些組織，值得先聊聊', '依「'+esc(state.conditions.scenario)+'」情境，從 '+orgs.length+' 家找出 '+candidates.length+' 家候選', '<div class="result-metrics"><div class="metric-pill"><b>'+candidates.length+'</b>候選組織</div><button class="secondary" data-step="5">產生推薦提示詞 ↗</button></div>')+
      (arr(r.relaxed).length ? '<div class="notice">名單不足，已自動放寬：'+r.relaxed.map(item => esc(item.field)+'（原本：'+esc(typeof item.original === 'object' && !Array.isArray(item.original) ? Object.entries(item.original || {}).map(([key,value]) => (key === 'min' ? '最少' : key === 'max' ? '最多' : key)+display(value)).join('、') : display(item.original))+'）'+(item.note ? ' · '+esc(item.note) : '')).join('；')+'</div>' : '')+
      (disabled.length ? '<details class="notice warning"><summary>有 '+disabled.length+' 條規則因資料缺欄位停用</summary>'+disabled.map(d => '<p>'+esc(d.id)+'：'+esc(d.reason)+'</p>').join('')+'</details>' : '')+
      '<div class="results-tools"><span>先看推薦理由，再用現場經驗確認。分數只協助排序。</span><button class="text-button" data-step="1">← 調整條件</button></div>'+
      (arr(r.excluded).length ? '<details class="notice"><summary>已排除 '+r.excluded.length+' 家'+(state.conditions.exclude_recent_partner ? '（近一年合作過）' : '')+'</summary>'+r.excluded.map(x => '<p>'+esc(x.name)+' · '+esc(x.reason)+'</p>').join('')+'</details>' : '')+
      (candidates.length ? '<div id="candidate-list">'+candidates.map((c, i) => candidateCard(c,i,maxScore)).join('')+'</div><div class="actions"><span class="muted">已留下 '+feedback.length+' 筆團隊回饋</span><button class="secondary" data-step="4">查看第二輪回饋 →</button></div>' : empty('沒有符合的組織，試試放寬條件', '可以減少議題或區域限制，再試一次。'));
  }
  function selectOrg(id, record = null) { state.selected = id; state.focusRecord = record; go(3); }
  function renderDetail() {
    const el = $('#step-3');
    if (!state.selected) { el.innerHTML = heading('03', '理解組織，讓邀請更到位', '選一個組織，看看它一路走來的脈絡。')+empty('想先認識哪一家？', '從候選名單點選「看組織詳情」，或從下方選擇組織。', 'back-results', '回到候選名單')+'<div class="panel" style="margin-top:20px"><label for="org-picker">選擇組織</label>'+orgPicker()+'</div>'; return; }
    const org = orgById(state.selected);
    if (!org) { el.innerHTML = empty('暫時找不到這家組織', '請回到名單選擇另一家。','back-results','回到候選名單'); return; }
    const stats = org.stats || {};
    const cited = new Set(arr(org.hits).flatMap(h => arr(h.evidence).map(e => e.record_id)));
    const orgFeedback = feedback.filter(f => f.org_id === org.id);
    el.innerHTML = heading('03', esc(org.name), '把欄位、接觸紀錄與團隊經驗放在一起，邀請前多理解一點。', '<button class="secondary" data-step="2">← 回候選名單</button>')+
      '<div class="detail-layout"><div class="detail-main"><div class="panel summary-card"><div class="eyebrow">先看重點，再看脈絡</div><h2>30 秒摘要</h2><ul>'+arr(org.summary_30s).map(s => '<li>'+esc(s)+'</li>').join('')+'</ul></div><div class="panel"><h2>系統判讀的標籤</h2><p class="body-copy">這個判讀符合你認識的組織嗎？點開依據，再留下你的確認。</p>'+ (arr(org.hits).length ? org.hits.map((hit, i) => '<article class="hit"><div class="hit-top"><div><span class="badge '+(hit.kind === 'warning' ? 'amber' : 'green')+'">'+esc(hit.label)+'</span><span class="rule">'+esc(hit.rule)+'</span></div><small class="muted">'+esc({ai:'AI 讀文字',keyword:'關鍵字',structured:'結構化欄位'}[hit.method] || '資料判讀')+'</small></div><div>'+evidenceButtons(hit.evidence, org.id)+'</div><div class="vote-actions"><button class="small-button" data-vote="agree" data-hit="'+i+'" aria-pressed="'+(votes[org.id+'|'+hit.rule] === 'agree')+'">認同</button><button class="small-button" data-vote="disagree" data-hit="'+i+'" aria-pressed="'+(votes[org.id+'|'+hit.rule] === 'disagree')+'">不認同</button>'+(votes[org.id+'|'+hit.rule] ? '<small class="muted">已記下你的確認</small>' : '')+'</div></article>').join('') : '<p class="body-copy">目前還沒有足夠資料產生標籤。</p>')+'</div><div class="panel"><h2>一路走來的接觸紀錄</h2><p class="body-copy">新到舊排列 · <span class="badge green">接觸紀錄</span> <span class="badge amber">顧問筆記</span></p><div class="timeline">'+arr(org.timeline).slice().sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).map(t => '<article id="record-'+esc(t.id)+'" class="timeline-item '+(t.kind === 'note' ? 'note' : '')+(state.focusRecord === t.id ? ' highlight' : '')+'"><time>'+esc(t.date || '日期未提供')+'</time> <span class="badge '+(t.kind === 'note' ? 'amber' : 'green')+'">'+esc(t.type || (t.kind === 'note' ? '顧問筆記' : '接觸紀錄'))+'</span> '+(cited.has(t.id) ? '<span class="badge">已引用為依據</span>' : '')+'<h3>'+esc(t.activity || t.type)+'</h3><p>'+esc(t.text)+'</p><small class="muted">'+esc(t.source || '來源未提供')+' · '+esc(t.id)+'</small></article>').join('')+'</div></div></div><aside class="detail-side"><div class="panel"><h2>組織基本資料</h2><dl class="field-grid">'+Object.entries(org.fields || {}).map(([key, value]) => '<div><dt>'+esc(key)+'</dt><dd class="'+(value == null || value === '' ? 'missing' : '')+'">'+esc(display(value))+'</dd></div>').join('')+'</dl></div><div class="panel"><h2>接觸足跡</h2><div class="stat-cards"><div><b>'+esc(stats.contacts ?? 0)+'</b><small>接觸紀錄</small></div><div><b>'+esc(stats.notes ?? 0)+'</b><small>顧問筆記</small></div></div><small class="muted">最近接觸日</small><p>'+esc(stats.last_contact || '尚無紀錄')+'</p><div class="inline-list">'+Object.entries(stats.by_type || {}).map(([type, n]) => '<span>'+esc(type)+' '+esc(n)+' 次</span>').join('')+'</div><p class="body-copy">資料來源系統</p><div class="org-tags">'+arr(stats.sources || [...new Set(arr(org.timeline).map(t => t.source).filter(Boolean))]).map(s => '<span class="badge">'+esc(s)+'</span>').join('')+'</div></div><div class="panel"><h2>這家的 PM 回饋</h2>'+ (orgFeedback.length ? orgFeedback.map(f => '<div class="hit"><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span> <small>'+esc(f.reason_code)+'</small><p>'+esc(f.note || '未填寫備註')+'</p><small class="muted">'+esc(f.date)+' · '+esc(f.by || 'PM')+'</small></div>').join('') : '<p class="body-copy">還沒有回饋。你的判斷會留在這家組織的脈絡裡。</p>')+'</div></aside></div>';
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
      (feedback.length ? '<div class="panel"><div class="section-label"><h2>PM 回饋紀錄</h2><span class="badge green">'+feedback.length+' 筆</span></div><div class="table-wrap feedback-table"><table><thead><tr><th>組織</th><th>判斷</th><th>原因與備註</th><th>日期</th><th>操作</th></tr></thead><tbody>'+feedback.map((f,i) => '<tr><td><button class="text-button" data-detail="'+esc(f.org_id)+'">'+esc(orgById(f.org_id)?.name || f.org_id)+'</button></td><td><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span></td><td>'+esc(f.reason_code || '—')+'<p class="muted">'+esc(f.note)+'</p></td><td>'+esc(f.date)+'<br><small class="muted">'+esc(f.by || 'PM')+'</small></td><td><button class="text-button danger" data-remove="'+i+'">刪除</button></td></tr>').join('')+'</tbody></table></div><div class="feedback-mobile">'+feedback.map((f,i) => '<article class="feedback-entry"><h3>'+esc(orgById(f.org_id)?.name || f.org_id)+'</h3><p><span class="badge '+(f.verdict === '符合' ? 'green' : 'amber')+'">'+esc(f.verdict)+'</span> '+esc(f.reason_code)+'</p><p>'+esc(f.note || '未填寫備註')+'</p><div class="row"><small class="muted">'+esc(f.date)+'</small><button class="text-button danger" data-remove="'+i+'">刪除</button></div></article>').join('')+'</div></div>' : empty('你的第一筆回饋，會讓名單更好', '回到候選名單，替組織標記「符合」或「不符合」。','back-results','回候選名單'))+
      '<div class="panel"><h2>把判斷帶回團隊</h2><p class="body-copy">下載回饋檔，請負責資料的夥伴放到 data/feedback/ 資料夾，再重新整理組織資料（build）。下次打開就能接著使用。</p><div class="actions"><button class="secondary" data-action="download" '+(!feedback.length ? 'disabled' : '')+'>↓ 下載回饋檔</button><button class="primary" data-action="rerank" '+(!state.result ? 'disabled' : '')+'>依回饋重排名單 →</button></div><p class="storage-note">'+(storageAvailable ? '回饋已保存在此瀏覽器，下載檔案可交給團隊接續使用。' : '此瀏覽器無法保存回饋；關閉頁面前，請先下載回饋檔。')+'</p></div>';
  }
  function saveFeedback(id, verdict, reason = '', note = '') {
    const item = runEngine(() => Engine.feedbackItem(id,verdict,reason,note));
    if (!item) return;
    const key = feedbackKey(item);
    if (feedback.some(f => feedbackKey(f) === key)) { toast('這筆回饋已經記下了。'); return; }
    deleted.delete(key); feedback.push(item); persist();
    if (state.result) rerank(); renderResults(); toast(verdict === '不符合' ? '已留下回饋，這家組織已移到名單最後。' : '已記下：這家組織符合本次需求。');
  }
  function openFeedback(id) {
    const dialog = $('#feedback-dialog');
    dialog.innerHTML = '<form id="negative-form"><div class="dialog-top"><h2 id="feedback-title">哪裡不符合這次需求？</h2><button type="button" data-action="close-feedback" aria-label="關閉回饋視窗">×</button></div><p class="body-copy">'+esc(orgById(id)?.name || id)+'<br>這家會保留在名單最後，讓判斷有跡可循。</p><label for="feedback-reason">主要原因</label><select id="feedback-reason" required><option value="">請選擇原因</option>'+reasonEntries.map(([key]) => '<option value="'+esc(key)+'">'+esc(key)+'</option>').join('')+'</select><p id="reason-hint" class="body-copy"></p><label for="feedback-note">留一句話，讓同事理解你的判斷</label><textarea id="feedback-note" required maxlength="500" placeholder="例如：團隊剛換主管，先等交接穩定再邀請。"></textarea><div class="actions"><button type="button" data-action="close-feedback">先取消</button><button type="submit" class="primary">送出回饋並重排</button></div></form>';
    dialog.dataset.org = id; dialog.showModal(); $('#feedback-reason').focus();
  }
  function findRecord(id) {
    for (const org of orgs) { const record = arr(org.timeline).find(t => t.id === id); if (record) return {org,record}; }
    return null;
  }
  function highlight(text, quote) {
    if (!quote || !text.includes(quote)) return esc(text);
    const index = text.indexOf(quote); return esc(text.slice(0,index))+'<mark>'+esc(quote)+'</mark>'+esc(text.slice(index+quote.length));
  }
  function openEvidence(id, orgId, quote = '') {
    const found = findRecord(id);
    const expected = orgById(orgId);
    const evidence = arr(expected?.hits).flatMap(h => arr(h.evidence)).find(e => e.record_id === id);
    const record = found?.record || evidence;
    lastDrawerFocus = document.activeElement;
    $('#evidence-drawer').innerHTML = '<div class="drawer-top"><div><div class="eyebrow">回到原始依據</div><h2 id="drawer-title">紀錄 '+esc(id)+'</h2></div><button data-action="close-drawer" aria-label="關閉原始紀錄">×</button></div>'+
      (record ? '<p class="muted">'+esc(found?.org.name || expected?.name || '')+'</p><dl class="field-grid"><div><dt>日期</dt><dd>'+esc(record.date || '未提供')+'</dd></div><div><dt>接觸類型</dt><dd>'+esc(record.type || '未提供')+'</dd></div><div><dt>來源系統</dt><dd>'+esc(record.source || evidence?.source || '未提供')+'</dd></div><div><dt>活動</dt><dd>'+esc(record.activity || '未提供')+'</dd></div></dl><h3>原始紀錄全文</h3><blockquote>'+highlight(String(record.text || record.quote || ''), quote || evidence?.quote || '')+'</blockquote><p class="body-copy">黃色標示是本次引用的片段。推薦理由仍需搭配整段原文判斷。</p>'+(found && orgId && found.org.id !== orgId ? '<div class="notice error">這筆紀錄屬於另一家組織，不能作為目前組織的依據。</div>' : '')+'<button class="primary" data-record-detail="'+esc(found?.org.id || orgId)+'" data-record="'+esc(id)+'">到組織時間軸看這筆紀錄 →</button>' : '<div class="notice error">找不到這筆紀錄，無法確認原文。請回到回覆內容修正引用。</div>');
    $('#drawer-backdrop').hidden = false; $('#evidence-drawer').hidden = false; document.body.classList.add('overlay-open');
    $('[data-action="close-drawer"]').focus();
  }
  function closeDrawer() {
    $('#drawer-backdrop').hidden = true; $('#evidence-drawer').hidden = true; document.body.classList.remove('overlay-open');
    if (lastDrawerFocus?.isConnected) lastDrawerFocus.focus();
  }
  function renderPrompt() {
    const el = $('#step-5');
    if (!state.result || !arr(state.result.candidates).length) { el.innerHTML = heading('05','讓 AI 幫忙寫，也讓每個依據可確認','推薦文字可以交給 Claude，最後的確認仍掌握在你手上。')+empty('先準備一份候選名單', '產生名單後，就能帶著原始依據請 Claude 撰寫推薦理由。','back-results','回候選名單'); return; }
    const prompt = runEngine(() => Engine.buildPrompt(state.conditions,state.result.candidates));
    state.prompt = prompt || '';
    el.innerHTML = heading('05','寫得有說服力，也查得到依據','如何確認 AI 結果是對的？先檢查紀錄編號存在，再確認它屬於這家組織。')+
      '<div class="notice">引用正確代表「紀錄存在且屬於該組織」，不代表 AI 的解讀一定正確。點開原文，仍由 PM 確認推薦理由是否合理。</div><div class="prompt-layout"><div class="panel"><div class="eyebrow">第一步 · 帶著依據請 AI 寫</div><h2>給 Claude 的推薦提示詞</h2><p class="body-copy">貼到 Claude，請它寫推薦理由。</p><label class="muted" for="prompt-text">已整理本次條件、候選與證據</label><textarea id="prompt-text" class="prompt-text" readonly>'+esc(state.prompt)+'</textarea><div class="actions"><button class="primary" data-action="copy-prompt">複製提示詞</button></div></div><div class="panel"><div class="eyebrow">第二步 · 交叉確認每一筆引用</div><h2>把 Claude 的回覆貼回來</h2><p class="body-copy">保留組織編號與紀錄編號，才能核對引用是否屬於正確的組織。</p><label class="muted" for="reply-text">Claude 的推薦內容</label><textarea id="reply-text" class="reply-text" placeholder="將包含組織與紀錄編號的回覆貼在這裡…">'+esc(state.reply)+'</textarea><div class="actions"><button class="primary" data-action="verify">檢查引用</button></div><div id="verification-results" aria-live="polite"></div></div></div>';
    renderVerification();
  }
  function renderVerification() {
    const el = $('#verification-results'); if (!el) return;
    const v = state.verified;
    if (!v) { el.innerHTML = ''; return; }
    const items = arr(v.items), bad = items.filter(item => item.status !== 'ok');
    // 依每行的驗證項目依序標色，避免同一筆紀錄在不同組織下被誤標為正確。
    const used = new Set();
    const rendered = state.reply.split('\n').map((line, lineIndex) => {
      const regex = /\b(?:C\d+|N\d+)\b/g; let out = '', from = 0, match;
      while ((match = regex.exec(line))) {
        const sameLine = items.findIndex((item, i) => !used.has(i) && item.record_id === match[0] && (typeof item.line === 'string' && item.line.includes(match[0]) && item.line.trim() === line.trim() || typeof item.line === 'number' && (item.line === lineIndex+1)));
        const index = sameLine >= 0 ? sameLine : items.findIndex((item,i) => !used.has(i) && item.record_id === match[0]);
        const item = index >= 0 ? items[index] : null; if (item) used.add(index);
        out += esc(line.slice(from,match.index))+'<button class="'+(item?.status === 'ok' ? 'citation-ok' : 'citation-bad')+'" data-evidence="'+esc(match[0])+'" data-org="'+esc(item?.org_id || '')+'">'+esc(match[0])+'</button>'; from = regex.lastIndex;
      }
      return out+esc(line.slice(from));
    }).join('\n');
    el.innerHTML = '<div class="verification-summary"><span>✓ '+esc(v.ok_count)+' 筆引用正確</span><span class="bad">'+esc(v.bad_count)+' 筆有問題</span></div>'+
      (!items.length ? '<div class="notice warning">沒有找到可檢查的引用。請保留組織編號與紀錄編號，再檢查一次。</div>' : '')+
      bad.map(item => '<div class="verification-problem">'+esc(item.org_id || '組織未標明')+' · <button class="evidence-button" data-evidence="'+esc(item.record_id)+'" data-org="'+esc(item.org_id)+'">'+esc(item.record_id)+'</button> '+(item.status === 'wrong_org' ? '這筆紀錄不屬於這家組織' : '找不到這筆紀錄')+'</div>').join('')+
      '<h3 style="margin-top:18px">回覆內容與引用標記</h3><p class="body-copy">綠色：引用核對通過 · 紅色：需修正或尚無法確認。點編號看原文。</p><div class="reply-render">'+rendered+'</div>';
  }
  document.addEventListener('input', event => {
    if (event.target.id === 'sentence') state.sentence = event.target.value;
    if (event.target.id === 'reply-text') { state.reply = event.target.value; state.verified = null; renderVerification(); }
    if (['need-n','multiplier'].includes(event.target.id)) $('#estimate').textContent = '將列出 '+((Number($('#need-n').value)||0)*(Number($('#multiplier').value)||0))+' 家候選';
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'org-picker' && event.target.value) selectOrg(event.target.value);
    if (event.target.id === 'feedback-reason') $('#reason-hint').textContent = settings.feedback_reasons?.[event.target.value]?.hint || '';
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'negative-form') return; event.preventDefault();
    const note = $('#feedback-note').value.trim(); if (!note) { $('#feedback-note').setCustomValidity('請留一句話說明原因。'); $('#feedback-note').reportValidity(); $('#feedback-note').setCustomValidity(''); return; }
    saveFeedback($('#feedback-dialog').dataset.org,'不符合',$('#feedback-reason').value,note); $('#feedback-dialog').close();
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
    if (button.dataset.scenario) {
      if (!collectConditions()) return;
      const scenario = button.dataset.scenario, defaults = settings.scenario_defaults?.[scenario] || {};
      state.conditions.scenario = scenario; state.conditions.multiplier = defaults.multiplier || state.conditions.multiplier; state.conditions.soft = clone(defaults.soft || []); renderConditions(); return;
    }
    if (button.dataset.detail) { selectOrg(button.dataset.detail); return; }
    if (button.dataset.evidence) { openEvidence(button.dataset.evidence,button.dataset.org,button.dataset.quote); return; }
    if (button.dataset.recordDetail) { closeDrawer(); selectOrg(button.dataset.recordDetail,button.dataset.record); return; }
    if (button.dataset.verdict) { if (!engineReady()) return; if (button.dataset.verdict === '符合') saveFeedback(button.dataset.org,'符合'); else openFeedback(button.dataset.org); return; }
    if (button.dataset.undo) { const latest = latestFeedback(button.dataset.undo); const index = feedback.indexOf(latest); if (index >= 0) { removeFeedback(index); toast('已撤回，名單已重新排序。'); } return; }
    if (button.dataset.remove != null) { removeFeedback(Number(button.dataset.remove)); toast('已刪除這筆回饋。'); return; }
    if (button.dataset.vote) {
      const hit = orgById(state.selected)?.hits?.[Number(button.dataset.hit)]; if (!hit) return;
      const key = state.selected+'|'+hit.rule; if (votes[key] === button.dataset.vote) delete votes[key]; else votes[key] = button.dataset.vote;
      write(VOTES,votes); const y = window.scrollY; state.focusRecord = null; renderDetail(); window.scrollTo(0,y); return;
    }
    switch (button.dataset.action) {
      case 'parse': {
        state.sentence = $('#sentence').value.trim();
        if (!state.sentence) { toast('先寫一句這次的需求，或選一個示範需求。'); $('#sentence').focus(); return; }
        const parsed = runEngine(() => Engine.parseSentence(state.sentence));
        if (parsed) { const example = demands.find(d => d.sentence.trim() === state.sentence); state.conditions = example ? {...clone(parsed), ...clone(example.conditions), _matched:[...arr(parsed._matched).filter(text => !text.includes('預設倍率')), '依示範需求：需要 '+example.conditions.need_n+' 家，先列 '+(example.conditions.need_n*example.conditions.multiplier)+' 家候選']} : clone(parsed); state.conditions.hard ||= {}; state.conditions.soft ||= []; renderConditions(); $('#conditions-form').scrollIntoView({behavior:'smooth',block:'start'}); }
        break;
      }
      case 'rank': if (collectConditions() && rerank()) go(2); break;
      case 'rerank': if (state.conditions && rerank()) { go(2); toast('已依 PM 回饋重新排列名單。'); } break;
      case 'back-input': go(1); break;
      case 'back-results': go(2); break;
      case 'close-feedback': $('#feedback-dialog').close(); break;
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
    }
  });
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

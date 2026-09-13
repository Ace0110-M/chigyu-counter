/* チー牛カウンター */
(() => {
  const CFG = window.CHIGYU_CONFIG;
  const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const ME_KEY = 'chigyu:me';
  const COLORS = ['#f26a1b', '#3b8f5a', '#3f7bd9', '#c94b9b', '#8a63d2', '#d9a03b', '#2aa7a0', '#d9463c'];

  const $ = (id) => document.getElementById(id);
  const state = { members: [], logs: [], meId: localStorage.getItem(ME_KEY), evidenceCount: 1, evidenceFile: null, memberSheetId: null };

  // ---------- ユーティリティ ----------
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }
  const me = () => state.members.find((m) => m.id === state.meId) || null;
  const initial = (name) => Array.from(name.trim())[0] || '?';
  const fmtTime = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const date = `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${date} ${time}`;
  };
  function eatenThisMonth(memberId) {
    const now = new Date();
    return state.logs
      .filter((l) => l.member_id === memberId && l.kind === 'eat' && l.delta < 0)
      .filter((l) => { const d = new Date(l.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); })
      .reduce((sum, l) => sum - l.delta, 0);
  }

  // ---------- データ取得 ----------
  async function load() {
    const [m, l] = await Promise.all([
      sb.from('chigyu_members').select('*').order('created_at'),
      sb.from('chigyu_logs').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    if (m.error) return toast('読み込みに失敗: ' + m.error.message);
    state.members = m.data;
    state.logs = l.data || [];
    if (state.meId && !me()) { state.meId = null; localStorage.removeItem(ME_KEY); }
    render();
    if (!state.meId) openRegister();
  }

  let reloadTimer;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 150); }
  sb.channel('chigyu')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chigyu_members' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chigyu_logs' }, scheduleReload)
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  // ---------- 描画 ----------
  function render() {
    const m = me();
    $('me-avatar').textContent = m ? initial(m.name) : '?';
    $('me-avatar').style.background = m ? m.color : '';
    $('me-avatar').style.color = m ? '#fff' : '';

    $('my-remaining').textContent = m ? m.remaining : '–';
    const eaten = m ? eatenThisMonth(m.id) : 0;
    $('my-month').textContent = eaten;
    const total = m ? eaten + m.remaining : 0;
    $('my-bar').style.width = total ? `${Math.round((eaten / total) * 100)}%` : '0%';
    $('btn-minus').disabled = !m || m.remaining <= 0;
    $('btn-plus').disabled = !m;
    $('btn-evidence').disabled = state.members.length === 0;

    // みんなの残り
    const max = Math.max(1, ...state.members.map((x) => x.remaining));
    $('members').innerHTML = state.members
      .slice()
      .sort((a, b) => b.remaining - a.remaining)
      .map((x) => `
        <button class="member" type="button" data-id="${x.id}">
          <div class="member-avatar" style="background:${x.color}">${esc(initial(x.name))}</div>
          <div class="member-body">
            <div class="member-head">
              <span class="member-name ${x.id === state.meId ? 'is-me' : ''}">${esc(x.name)}</span>
              <span class="member-count">${x.remaining}杯</span>
            </div>
            <div class="bar"><div class="bar-fill" style="width:${Math.round((x.remaining / max) * 100)}%"></div></div>
          </div>
        </button>`).join('');

    // 履歴
    $('history').innerHTML = renderLogs(state.logs);
    if (state.memberSheetId && !$('sheet-member').hidden) renderMemberSheet();

    // セレクト類
    const opts = state.members.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    $('evidence-member').innerHTML = opts;
    $('setting-me').innerHTML = opts;
    if (state.meId) { $('evidence-member').value = state.meId; $('setting-me').value = state.meId; }
    $('setting-name').placeholder = m ? m.name : '新しいニックネーム';
    $('setting-rename').disabled = !m;
    $('setting-delete').disabled = !m;

    // 登録シートの既存メンバー
    $('register-existing').hidden = state.members.length === 0;
    $('register-existing-list').innerHTML = state.members.map((x) => `<button type="button" class="chip" data-id="${x.id}">${esc(x.name)}</button>`).join('');
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderLogs(logs) {
    const byId = Object.fromEntries(state.members.map((x) => [x.id, x]));
    const html = logs.map((l) => {
      const who = byId[l.member_id];
      if (!who) return '';
      const n = Math.abs(l.delta);
      const label = l.kind === 'eat'
        ? `<span class="log-delta minus">−${n}杯</span> 食べた`
        : l.delta > 0 ? `<span class="log-delta plus">＋${n}杯</span> 追加` : `<span class="log-delta minus">−${n}杯</span> 減らした`;
      const img = l.evidence_url
        ? `<img class="log-thumb" src="${esc(l.evidence_url)}" alt="証拠" loading="lazy" data-full="${esc(l.evidence_url)}" />`
        : `<div class="log-noimg">${l.delta > 0 ? '＋' : '−'}</div>`;
      return `
        <div class="log">
          <div class="member-avatar" style="background:${who.color};width:40px;height:40px;font-size:15px">${esc(initial(who.name))}</div>
          <div class="log-body">
            <div class="log-main">${esc(who.name)} ${label}</div>
            <div class="log-time">${fmtTime(l.created_at)}</div>
          </div>
          ${img}
        </div>`;
    }).join('');
    return html || '<div class="log" style="justify-content:center;color:var(--muted)">まだ履歴がありません</div>';
  }

  // ---------- 操作 ----------
  async function adjust(memberId, delta, kind = 'adjust', evidenceUrl = null) {
    const { data, error } = await sb.rpc('chigyu_adjust', { p_member_id: memberId, p_delta: delta, p_kind: kind, p_evidence_url: evidenceUrl });
    if (error) { toast('更新に失敗: ' + error.message); return null; }
    // ローカルにも即反映（Realtimeが来る前に）
    const mm = state.members.find((x) => x.id === memberId);
    if (mm) mm.remaining = data;
    render();
    scheduleReload();
    return data;
  }

  function setMe(id) {
    state.meId = id;
    localStorage.setItem(ME_KEY, id);
    render();
  }

  async function register(name) {
    name = name.trim();
    if (!name) return;
    const color = COLORS[state.members.length % COLORS.length];
    const { data, error } = await sb.from('chigyu_members').insert({ name, color }).select().single();
    if (error) {
      toast(error.code === '23505' ? 'そのニックネームはもう使われています' : '登録に失敗: ' + error.message);
      return false;
    }
    state.members.push(data);
    setMe(data.id);
    toast(`ようこそ、${name}さん！`);
    return true;
  }

  // 画像を縮小してJPEGにする（アップロード容量を抑える）
  function shrinkImage(file, maxSide = 1280) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めません')); };
      img.src = url;
    });
  }

  async function uploadEvidence(file) {
    const blob = await shrinkImage(file);
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from(CFG.bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return sb.storage.from(CFG.bucket).getPublicUrl(path).data.publicUrl;
  }

  // ---------- シート ----------
  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }
  function openRegister() {
    if (!$('sheet-register').hidden) return; // 入力中に再描画で消さない
    $('register-name').value = '';
    openSheet('sheet-register');
    setTimeout(() => $('register-name').focus(), 250);
  }

  function openEvidence() {
    state.evidenceCount = 1;
    state.evidenceFile = null;
    $('evidence-file').value = '';
    $('evidence-preview').hidden = true;
    $('dropzone-empty').hidden = false;
    if (state.meId) $('evidence-member').value = state.meId;
    updateEvidenceCount();
    openSheet('sheet-evidence');
  }
  function updateEvidenceCount() {
    $('evidence-count').textContent = `${state.evidenceCount}杯`;
    $('evidence-submit-label').textContent = `記録して${state.evidenceCount}杯減らす`;
  }

  function openMember(id) {
    if (!state.members.some((y) => y.id === id)) return;
    state.memberSheetId = id;
    renderMemberSheet();
    openSheet('sheet-member');
  }
  function renderMemberSheet() {
    const x = state.members.find((y) => y.id === state.memberSheetId);
    if (!x) return closeSheet('sheet-member');
    $('member-title').textContent = `${x.name}の履歴`;
    $('member-remaining').textContent = x.remaining;
    $('member-month').textContent = eatenThisMonth(x.id);
    $('member-history').innerHTML = renderLogs(state.logs.filter((l) => l.member_id === x.id));
  }

  // ---------- イベント ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-active', x === t));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${t.dataset.view}`));
    window.scrollTo({ top: 0 });
  }));

  $('btn-plus').addEventListener('click', () => state.meId && adjust(state.meId, 1));
  $('btn-minus').addEventListener('click', () => state.meId && adjust(state.meId, -1));
  $('btn-evidence').addEventListener('click', openEvidence);
  $('me-avatar').addEventListener('click', () => { if (state.meId) openMember(state.meId); else openRegister(); });

  $('members').addEventListener('click', (e) => { const b = e.target.closest('.member'); if (b) openMember(b.dataset.id); });
  ['history', 'member-history'].forEach((id) => $(id).addEventListener('click', (e) => {
    const img = e.target.closest('[data-full]');
    if (img) { $('viewer-img').src = img.dataset.full; $('viewer').hidden = false; }
  }));
  $('viewer').addEventListener('click', () => { $('viewer').hidden = true; $('viewer-img').src = ''; });

  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.sheet').id)));
  document.querySelectorAll('.sheet').forEach((s) => s.addEventListener('click', (e) => {
    if (e.target === s && s.id !== 'sheet-register') closeSheet(s.id);
  }));

  // 登録
  $('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await register($('register-name').value)) closeSheet('sheet-register');
  });
  $('register-existing-list').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) { setMe(c.dataset.id); closeSheet('sheet-register'); }
  });

  // 証拠
  $('evidence-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.evidenceFile = f;
    const p = $('evidence-preview');
    p.src = URL.createObjectURL(f);
    p.hidden = false;
    $('dropzone-empty').hidden = true;
  });
  document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => {
    state.evidenceCount = Math.max(1, Math.min(20, state.evidenceCount + Number(b.dataset.step)));
    updateEvidenceCount();
  }));
  $('form-evidence').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.evidenceFile) return toast('食べた写真を選んでください');
    const memberId = $('evidence-member').value;
    const btn = $('evidence-submit');
    btn.disabled = true;
    $('evidence-submit-label').textContent = 'アップロード中…';
    try {
      const url = await uploadEvidence(state.evidenceFile);
      const left = await adjust(memberId, -state.evidenceCount, 'eat', url);
      if (left !== null) {
        closeSheet('sheet-evidence');
        toast(left === 0 ? '🎉 完食！残り0杯です' : `残り${left}杯！`);
      }
    } catch (err) {
      toast('アップロードに失敗: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      updateEvidenceCount();
    }
  });

  // 設定
  $('setting-me').addEventListener('change', (e) => { setMe(e.target.value); toast('自分を切り替えました'); });
  $('setting-new').addEventListener('click', openRegister);
  $('setting-rename').addEventListener('click', async () => {
    const name = $('setting-name').value.trim();
    if (!name || !state.meId) return;
    const { error } = await sb.from('chigyu_members').update({ name }).eq('id', state.meId);
    if (error) return toast(error.code === '23505' ? 'そのニックネームはもう使われています' : '変更に失敗: ' + error.message);
    $('setting-name').value = '';
    toast('ニックネームを変更しました');
    load();
  });
  $('setting-delete').addEventListener('click', async () => {
    const m = me();
    if (!m || !confirm(`「${m.name}」を削除しますか？履歴も消えます。`)) return;
    const { error } = await sb.from('chigyu_members').delete().eq('id', m.id);
    if (error) return toast('削除に失敗: ' + error.message);
    localStorage.removeItem(ME_KEY);
    state.meId = null;
    toast('削除しました');
    load();
  });

  // PWA
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  load();
})();

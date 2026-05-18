/* =====================================================================
 * iQube Helper - 勤怠一括打刻ツール
 * https://github.com/KoichiMiyasaka/iqube-helper
 *
 * このファイルはブックマークレットから動的に読み込まれます。
 *
 * 【定時を変更したい場合】
 *   下の DEFAULT_TIMES の値を書き換えて Push してください。
 *   個人で時刻だけ変えたい場合は、画面右上の「設定」ボタンから
 *   ブラウザに保存できます（localStorage）。
 * ===================================================================== */

(() => {
  'use strict';

  // ▼▼▼ ここを編集すると、配布されたメンバー全員のデフォルト定時が変わります ▼▼▼
  const DEFAULT_TIMES = {
    arrival:   { hour: 9,  minute: 0  },  // 出社
    leaving:   { hour: 18, minute: 0  },  // 退社
    outing:    { hour: 12, minute: 0  },  // 外出（休憩開始）
    returning: { hour: 13, minute: 0  },  // 戻り（休憩終了）
  };
  // ▲▲▲ ここを編集すると、配布されたメンバー全員のデフォルト定時が変わります ▲▲▲

  // ▼▼▼ 日本の祝日リスト（出典: 内閣府 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html） ▼▼▼
  // 年1回（だいたい2月の閣議決定後）に更新してください。
  // 振替休日も含みます。
  const JP_HOLIDAYS = new Set([
    // 2025
    '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
    '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05','2025-05-06',
    '2025-07-21','2025-08-11','2025-09-15','2025-09-23','2025-10-13',
    '2025-11-03','2025-11-23','2025-11-24',
    // 2026
    '2026-01-01','2026-01-02','2026-01-12','2026-02-11','2026-02-23',
    '2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
    '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12',
    '2026-11-03','2026-11-23',
    // 2027
    '2027-01-01','2027-01-11','2027-02-11','2027-02-23',
    '2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05',
    '2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11',
    '2027-11-03','2027-11-23',
  ]);
  // ▲▲▲ 祝日リスト ▲▲▲

  const STORAGE_KEY = 'iqubeHelper.userTimes.v1';
  const HOST_PATTERN = /(^|\.)iqube\.net$/i;
  const PANEL_ID = 'iqubeHelperPanel';

  // ---------- 既存パネルがあれば閉じる（トグル動作） ----------
  if (document.getElementById(PANEL_ID)) {
    document.getElementById(PANEL_ID).remove();
    return;
  }

  // ---------- iQube ドメインチェック ----------
  if (!HOST_PATTERN.test(location.host)) {
    alert('このツールは iQube (app.iqube.net) のページで実行してください。\n現在のURL: ' + location.host);
    return;
  }

  // ---------- ユーザー設定（localStorage）読み書き ----------
  function loadUserTimes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return JSON.parse(JSON.stringify(DEFAULT_TIMES));
  }
  function saveUserTimes(times) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(times));
  }
  function resetUserTimes() {
    localStorage.removeItem(STORAGE_KEY);
  }

  let userTimes = loadUserTimes();

  // ---------- CSRFトークン取得 ----------
  // iQube は <meta csrf-token> を埋め込まず、編集モーダルを開いた時に
  // サーバーから返るHTML内の <input name="authenticity_token"> で渡してくる。
  // よって、編集エンドポイントを1回叩いてHTMLからトークンを抽出する。
  let cachedToken = null;
  async function getCsrfToken(dateForFetch) {
    // 既存のDOMにあれば優先（保険）
    const fromDom = document.querySelector('meta[name=csrf-token]')?.content
      || document.querySelector('input[name=authenticity_token]')?.value;
    if (fromDom) { console.log('[iQube Helper] token from DOM'); return fromDom; }
    if (cachedToken) return cachedToken;

    // 任意の過去日で edit を叩いてトークンを抽出
    const d = dateForFetch || todayLocal();
    const dateStr = encodeURIComponent(fmtIQube(d));
    const url = `/time_cards/edit?_=${Date.now()}&date=${dateStr}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*' },
    });
    if (!res.ok) throw new Error(`edit fetch failed: ${res.status}`);
    const html = await res.text();
    console.log('[iQube Helper] edit response length:', html.length);
    console.log('[iQube Helper] edit response (first 500 chars):', html.substring(0, 500));

    // フォールバックで複数パターンを試す
    const patterns = [
      // input パターン（name先、value後）
      /name\s*=\s*["']authenticity_token["'][^>]*?value\s*=\s*["']([^"']+)["']/i,
      // input パターン（value先、name後）
      /value\s*=\s*["']([^"']+)["'][^>]*?name\s*=\s*["']authenticity_token["']/i,
      // meta タグ
      /<meta[^>]+name\s*=\s*["']csrf-token["'][^>]+content\s*=\s*["']([^"']+)["']/i,
      /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']csrf-token["']/i,
      // JSON的に埋め込まれている可能性
      /["']authenticity_token["']\s*:\s*["']([^"']+)["']/i,
      // hidden inputで属性順がランダムなパターン（より緩く）
      /authenticity_token[^>]*?value\s*=\s*["']([^"']{20,})["']/i,
      /value\s*=\s*["']([^"']{20,})["'][^>]*?authenticity_token/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        console.log('[iQube Helper] token matched by:', re.source);
        cachedToken = m[1];
        return cachedToken;
      }
    }

    // 最後の手段: DOMParser で <input> を直接探す
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const input = doc.querySelector('input[name="authenticity_token"]');
      if (input?.value) {
        console.log('[iQube Helper] token from DOMParser');
        cachedToken = input.value;
        return cachedToken;
      }
      const meta = doc.querySelector('meta[name="csrf-token"]');
      if (meta?.content) {
        cachedToken = meta.content;
        return cachedToken;
      }
    } catch (e) {
      console.warn('[iQube Helper] DOMParser failed:', e);
    }

    console.error('[iQube Helper] レスポンス全文:', html);
    throw new Error('authenticity_token をHTMLから抽出できませんでした（Consoleにレスポンス全文を出力）');
  }

  // ---------- 既存タイムカードの取得（備考あり日リスト構築用） ----------
  // 指定月のタイムカード一覧HTMLを取得し、備考欄が空でない日のYYYY-MM-DD Set を返す。
  // 月またぎの日付配列にも対応するため、関係する月だけ取得してマージする。
  async function fetchRemarksDates(months) {
    // months: Set<'YYYY-MM'>
    const result = new Set();
    for (const ym of months) {
      const [y, m] = ym.split('-').map(n => parseInt(n, 10));
      const dateParam = `${y}/${String(m).padStart(2,'0')}/01`;
      const url = `/time_cards?_=${Date.now()}&date=${encodeURIComponent(dateParam)}`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*' },
        });
        if (!res.ok) {
          console.warn('[iQube Helper] timecard fetch failed:', ym, res.status);
          continue;
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // 各日付の行: <tr> 内に「N日(曜)」セル + 出社..戻りの4セル + 編集2セル + 備考セル
        // 月画面のテーブル構造を踏まえ、weekday クラスの隣の行を解析
        const rows = doc.querySelectorAll('tr');
        rows.forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length < 8) return;
          // 日付は weekday クラスがあるセル: 「1(金)」のような形式
          const weekdayTd = tr.querySelector('td.weekday');
          if (!weekdayTd) return;
          const dayMatch = weekdayTd.textContent.match(/^(\d{1,2})/);
          if (!dayMatch) return;
          const day = parseInt(dayMatch[1], 10);
          // 備考セル = 行の最後のtd（または最後から2番目）
          // 構造: [月名] [日] [出] [退] [外] [戻] [編集○] [編集🔍] [備考]
          const remarksTd = tds[tds.length - 1];
          const remarks = (remarksTd?.textContent || '').trim();
          // '---' や空白のみ、ハイフン記号などは空扱い
          const isEmpty = remarks === '' || remarks === '---' || remarks === '—' || /^[-—\s]*$/.test(remarks);
          if (!isEmpty) {
            const ymd = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            result.add(ymd);
            console.log('[iQube Helper] 備考あり:', ymd, '→', remarks);
          }
        });
      } catch (e) {
        console.warn('[iQube Helper] fetchRemarksDates error for', ym, e);
      }
    }
    return result;
  }

  // ---------- 日付ユーティリティ ----------
  function todayLocal() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }
  function fmtYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function fmtIQube(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day} (00:00)`;
  }
  function isFuture(d) {
    return d.getTime() > todayLocal().getTime();
  }
  function isWeekend(d) {
    const w = d.getDay();
    return w === 0 || w === 6;
  }
  function isHoliday(d) {
    return JP_HOLIDAYS.has(fmtYmd(d));
  }
  function isOffDay(d) {
    return isWeekend(d) || isHoliday(d);
  }

  // ---------- 打刻 API（1日分） ----------
  async function punch(date, times) {
    const token = await getCsrfToken(date);
    if (!token) throw new Error('CSRFトークンが取得できません');

    const fd = new FormData();
    fd.append('_method', 'put');
    fd.append('authenticity_token', token);
    fd.append('date', fmtIQube(date));
    fd.append('time_card[arrival_hour]',     String(times.arrival.hour));
    fd.append('time_card[arrival_minute]',   String(times.arrival.minute));
    fd.append('time_card[leaving_hour]',     String(times.leaving.hour));
    fd.append('time_card[leaving_minute]',   String(times.leaving.minute));
    fd.append('time_card[outing_hour]',      String(times.outing.hour));
    fd.append('time_card[outing_minute]',    String(times.outing.minute));
    fd.append('time_card[returning_hour]',   String(times.returning.hour));
    fd.append('time_card[returning_minute]', String(times.returning.minute));
    fd.append('time_card[remarks]', '');

    const r = await fetch('/time_cards', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*' },
    });
    return r.status;
  }

  // ---------- 一括打刻（共通ロジック） ----------
  async function bulkPunch(dates, times, logEl) {
    // 1) 未来日フィルタ
    let valid = dates.filter(d => !isFuture(d));
    const futureSkipped = dates.length - valid.length;
    if (futureSkipped > 0) {
      logEl.insertAdjacentHTML('beforeend',
        `<div style="color:#888;">⚠️ 未来日 ${futureSkipped}件 はスキップ</div>`);
    }
    if (valid.length === 0) {
      logEl.insertAdjacentHTML('beforeend', `<div style="color:#f44336;">対象日がありません</div>`);
      return { ok: 0, ng: 0 };
    }

    // 2) 備考欄が入っている日を取得してスキップ
    logEl.insertAdjacentHTML('beforeend',
      `<div style="color:#888;">📋 備考欄付きの日を確認中…</div>`);
    const months = new Set(valid.map(d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`));
    let remarksDates = new Set();
    try {
      remarksDates = await fetchRemarksDates(months);
    } catch (e) {
      logEl.insertAdjacentHTML('beforeend',
        `<div style="color:#f44336;">⚠️ 備考チェックに失敗: ${e.message}（続行します）</div>`);
    }
    const beforeRemarksFilter = valid.length;
    const skippedByRemarks = [];
    valid = valid.filter(d => {
      if (remarksDates.has(fmtYmd(d))) {
        skippedByRemarks.push(fmtYmd(d));
        return false;
      }
      return true;
    });
    if (skippedByRemarks.length > 0) {
      logEl.insertAdjacentHTML('beforeend',
        `<div style="color:#ff9800;">⚠️ 備考あり ${skippedByRemarks.length}件 はスキップ: ${skippedByRemarks.join(', ')}</div>`);
    }
    if (valid.length === 0) {
      logEl.insertAdjacentHTML('beforeend', `<div style="color:#f44336;">打刻対象日が0件になりました</div>`);
      return { ok: 0, ng: 0 };
    }

    if (!confirm(`${valid.length}日分を打刻します。よろしいですか？`)) {
      return { ok: 0, ng: 0, canceled: true };
    }

    let ok = 0, ng = 0;
    for (const d of valid) {
      const ds = fmtYmd(d);
      try {
        const status = await punch(d, times);
        if (status === 201 || status === 200) {
          ok++;
          logEl.insertAdjacentHTML('beforeend', `<div style="color:#4CAF50;">✓ ${ds} 成功</div>`);
        } else {
          ng++;
          logEl.insertAdjacentHTML('beforeend', `<div style="color:#f44336;">✗ ${ds} 失敗 (HTTP ${status})</div>`);
        }
      } catch (e) {
        ng++;
        logEl.insertAdjacentHTML('beforeend', `<div style="color:#f44336;">✗ ${ds} エラー: ${e.message}</div>`);
      }
      logEl.scrollTop = logEl.scrollHeight;
      await new Promise(r => setTimeout(r, 250));
    }
    logEl.insertAdjacentHTML('beforeend',
      `<div style="font-weight:bold;margin-top:8px;border-top:1px solid #ddd;padding-top:6px;">完了: 成功 ${ok}件 / 失敗 ${ng}件</div>
       <div style="color:#666;">ページをリロードして確認してください</div>`);
    return { ok, ng };
  }

  // ---------- UI ----------
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="iqh-header">
      <strong>iQube クイック打刻</strong>
      <span class="iqh-close" id="iqhClose">×</span>
    </div>

    <div class="iqh-tabs">
      <button class="iqh-tab iqh-tab-active" data-tab="today">今日</button>
      <button class="iqh-tab" data-tab="month">月一括</button>
      <button class="iqh-tab" data-tab="custom">日付選択</button>
      <button class="iqh-tab" data-tab="settings">設定</button>
    </div>

    <div class="iqh-body">
      <!-- 今日 -->
      <div class="iqh-pane iqh-pane-active" data-pane="today">
        <p class="iqh-desc">本日（<span id="iqhTodayLabel"></span>）の勤怠を打刻します。</p>
        <div class="iqh-times-preview" id="iqhPreviewToday"></div>
        <button class="iqh-btn iqh-btn-primary" id="iqhRunToday">今日を打刻</button>
      </div>

      <!-- 月一括 -->
      <div class="iqh-pane" data-pane="month">
        <p class="iqh-desc">選択した月の <strong>平日のみ</strong> を一括打刻します。</p>
        <label class="iqh-row">
          対象月:
          <input type="month" id="iqhMonth">
        </label>
        <label class="iqh-row">
          <input type="checkbox" id="iqhSkipWeekend" checked>
          土日・祝日をスキップ
        </label>
        <div class="iqh-times-preview" id="iqhPreviewMonth"></div>
        <button class="iqh-btn iqh-btn-primary" id="iqhRunMonth">月の平日を打刻</button>
      </div>

      <!-- 日付選択 -->
      <div class="iqh-pane" data-pane="custom">
        <p class="iqh-desc">複数の日付を選んで一括打刻します（カンマ区切り or 範囲）。</p>
        <label class="iqh-row iqh-row-block">
          日付（カンマ区切り）:
          <input type="text" id="iqhCustomDates" placeholder="例: 2026-05-01, 2026-05-07, 2026-05-08">
        </label>
        <label class="iqh-row iqh-row-block">
          または範囲（開始日 〜 終了日）:
          <span class="iqh-range">
            <input type="date" id="iqhRangeFrom">
            〜
            <input type="date" id="iqhRangeTo">
          </span>
        </label>
        <label class="iqh-row">
          <input type="checkbox" id="iqhCustomSkipWeekend" checked>
          範囲指定時に土日・祝日をスキップ
        </label>
        <div class="iqh-times-preview" id="iqhPreviewCustom"></div>
        <button class="iqh-btn iqh-btn-primary" id="iqhRunCustom">選択した日を打刻</button>
      </div>

      <!-- 設定 -->
      <div class="iqh-pane" data-pane="settings">
        <p class="iqh-desc">定時を変更します（このブラウザにのみ保存）。</p>
        <div class="iqh-time-grid">
          <label>出社 <input type="time" id="iqhTimeIn"></label>
          <label>退社 <input type="time" id="iqhTimeOut"></label>
          <label>外出 <input type="time" id="iqhTimeOuting"></label>
          <label>戻り <input type="time" id="iqhTimeReturn"></label>
        </div>
        <div class="iqh-btn-row">
          <button class="iqh-btn iqh-btn-primary" id="iqhSaveTimes">保存</button>
          <button class="iqh-btn iqh-btn-secondary" id="iqhResetTimes">デフォルトに戻す</button>
        </div>
        <p class="iqh-note">※ 全員のデフォルト定時を変えたい場合は GitHub の loader.js を編集してください。</p>
      </div>
    </div>

    <div class="iqh-log" id="iqhLog"></div>
  `;
  document.body.appendChild(panel);

  // ---------- スタイル ----------
  const style = document.createElement('style');
  style.id = 'iqubeHelperStyle';
  style.textContent = `
    #${PANEL_ID} {
      position: fixed; top: 16px; right: 16px;
      width: 360px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      background: #fff; color: #333;
      border: 2px solid #4CAF50; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.22);
      font-family: -apple-system, "Hiragino Sans", "Helvetica Neue", Arial, sans-serif;
      font-size: 13px; line-height: 1.5;
      z-index: 2147483647;
      overflow: hidden; display: flex; flex-direction: column;
    }
    #${PANEL_ID} * { box-sizing: border-box; }
    #${PANEL_ID} .iqh-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; background: #4CAF50; color: #fff;
    }
    #${PANEL_ID} .iqh-header strong { font-size: 14px; }
    #${PANEL_ID} .iqh-close {
      cursor: pointer; font-size: 20px; line-height: 1; padding: 0 4px;
    }
    #${PANEL_ID} .iqh-tabs {
      display: flex; border-bottom: 1px solid #ddd; background: #f7f7f7;
    }
    #${PANEL_ID} .iqh-tab {
      flex: 1; padding: 8px 4px; border: none; background: transparent;
      cursor: pointer; font-size: 12px; color: #555;
      border-bottom: 2px solid transparent;
    }
    #${PANEL_ID} .iqh-tab-active {
      color: #4CAF50; font-weight: bold; border-bottom-color: #4CAF50;
      background: #fff;
    }
    #${PANEL_ID} .iqh-body {
      padding: 12px 14px; overflow-y: auto;
    }
    #${PANEL_ID} .iqh-pane { display: none; }
    #${PANEL_ID} .iqh-pane-active { display: block; }
    #${PANEL_ID} .iqh-desc { margin: 0 0 10px; color: #555; font-size: 12px; }
    #${PANEL_ID} .iqh-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
      font-size: 12px;
    }
    #${PANEL_ID} .iqh-row-block { display: block; }
    #${PANEL_ID} .iqh-row-block input[type=text],
    #${PANEL_ID} .iqh-row-block input[type=date] {
      width: 100%; margin-top: 4px;
    }
    #${PANEL_ID} .iqh-range {
      display: flex; align-items: center; gap: 6px; margin-top: 4px;
    }
    #${PANEL_ID} .iqh-range input { flex: 1; }
    #${PANEL_ID} input[type=text],
    #${PANEL_ID} input[type=date],
    #${PANEL_ID} input[type=month],
    #${PANEL_ID} input[type=time] {
      padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px;
      font-size: 13px;
    }
    #${PANEL_ID} .iqh-times-preview {
      background: #f5f9f5; border: 1px dashed #c2dcc2; border-radius: 4px;
      padding: 6px 8px; margin: 8px 0; font-size: 11px; color: #555;
    }
    #${PANEL_ID} .iqh-btn {
      width: 100%; padding: 10px; border: none; border-radius: 5px;
      font-size: 14px; font-weight: bold; cursor: pointer; margin-top: 4px;
    }
    #${PANEL_ID} .iqh-btn-primary { background: #4CAF50; color: #fff; }
    #${PANEL_ID} .iqh-btn-primary:hover { background: #43a047; }
    #${PANEL_ID} .iqh-btn-secondary { background: #eee; color: #333; }
    #${PANEL_ID} .iqh-btn-row { display: flex; gap: 8px; }
    #${PANEL_ID} .iqh-btn-row .iqh-btn { flex: 1; }
    #${PANEL_ID} .iqh-time-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;
    }
    #${PANEL_ID} .iqh-time-grid label {
      display: flex; flex-direction: column; font-size: 11px; color: #555;
    }
    #${PANEL_ID} .iqh-time-grid input { margin-top: 4px; }
    #${PANEL_ID} .iqh-note {
      font-size: 10px; color: #999; margin: 8px 0 0; line-height: 1.4;
    }
    #${PANEL_ID} .iqh-log {
      border-top: 1px solid #eee; padding: 8px 14px;
      max-height: 160px; overflow-y: auto;
      font-size: 11px; color: #555;
    }
    #${PANEL_ID} .iqh-log:empty { display: none; }
  `;
  document.head.appendChild(style);

  // ---------- 要素参照 ----------
  const $ = (id) => document.getElementById(id);
  const logEl = $('iqhLog');

  // ---------- タブ切り替え ----------
  panel.querySelectorAll('.iqh-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.iqh-tab').forEach(b => b.classList.remove('iqh-tab-active'));
      panel.querySelectorAll('.iqh-pane').forEach(p => p.classList.remove('iqh-pane-active'));
      btn.classList.add('iqh-tab-active');
      panel.querySelector(`.iqh-pane[data-pane="${btn.dataset.tab}"]`).classList.add('iqh-pane-active');
    });
  });

  // ---------- 閉じる ----------
  $('iqhClose').onclick = () => {
    panel.remove();
    style.remove();
  };

  // ---------- 時刻プレビュー更新 ----------
  function previewHtml() {
    const t = userTimes;
    const f = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    return `打刻内容: 出社 ${f(t.arrival.hour, t.arrival.minute)} / 退社 ${f(t.leaving.hour, t.leaving.minute)} / 外出 ${f(t.outing.hour, t.outing.minute)} / 戻り ${f(t.returning.hour, t.returning.minute)}`;
  }
  function refreshPreviews() {
    ['iqhPreviewToday','iqhPreviewMonth','iqhPreviewCustom'].forEach(id => {
      const el = $(id); if (el) el.textContent = previewHtml();
    });
  }
  refreshPreviews();

  // ---------- 初期値 ----------
  const today = todayLocal();
  $('iqhTodayLabel').textContent = fmtYmd(today);
  $('iqhMonth').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  $('iqhRangeFrom').value = fmtYmd(today);
  $('iqhRangeTo').value = fmtYmd(today);
  $('iqhRangeFrom').max = fmtYmd(today);
  $('iqhRangeTo').max = fmtYmd(today);

  // 設定タブ初期値
  function fillSettingsInputs() {
    const t = userTimes;
    const v = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    $('iqhTimeIn').value     = v(t.arrival.hour,   t.arrival.minute);
    $('iqhTimeOut').value    = v(t.leaving.hour,   t.leaving.minute);
    $('iqhTimeOuting').value = v(t.outing.hour,    t.outing.minute);
    $('iqhTimeReturn').value = v(t.returning.hour, t.returning.minute);
  }
  fillSettingsInputs();

  // ---------- 設定保存 ----------
  function parseTime(str) {
    const [h, m] = str.split(':');
    return { hour: parseInt(h, 10), minute: parseInt(m, 10) };
  }
  $('iqhSaveTimes').onclick = () => {
    userTimes = {
      arrival:   parseTime($('iqhTimeIn').value),
      leaving:   parseTime($('iqhTimeOut').value),
      outing:    parseTime($('iqhTimeOuting').value),
      returning: parseTime($('iqhTimeReturn').value),
    };
    saveUserTimes(userTimes);
    refreshPreviews();
    alert('保存しました。');
  };
  $('iqhResetTimes').onclick = () => {
    if (!confirm('デフォルトの定時に戻します。よろしいですか？')) return;
    resetUserTimes();
    userTimes = JSON.parse(JSON.stringify(DEFAULT_TIMES));
    fillSettingsInputs();
    refreshPreviews();
    alert('デフォルトに戻しました。');
  };

  // ---------- 今日を打刻 ----------
  $('iqhRunToday').onclick = async () => {
    logEl.innerHTML = '';
    if (isFuture(today)) {
      alert('未来日には打刻できません。');
      return;
    }
    await bulkPunch([today], userTimes, logEl);
  };

  // ---------- 月の平日を打刻 ----------
  $('iqhRunMonth').onclick = async () => {
    logEl.innerHTML = '';
    const v = $('iqhMonth').value;
    if (!v) { alert('対象月を選択してください'); return; }
    const [y, m] = v.split('-').map(n => parseInt(n, 10));
    const skipWeekend = $('iqhSkipWeekend').checked;
    const daysInMonth = new Date(y, m, 0).getDate();
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(y, m - 1, d);
      if (skipWeekend && isOffDay(dt)) continue;
      dates.push(dt);
    }
    await bulkPunch(dates, userTimes, logEl);
  };

  // ---------- 選択した日付を打刻 ----------
  $('iqhRunCustom').onclick = async () => {
    logEl.innerHTML = '';
    const text = $('iqhCustomDates').value.trim();
    const from = $('iqhRangeFrom').value;
    const to   = $('iqhRangeTo').value;
    const skipWeekend = $('iqhCustomSkipWeekend').checked;

    const dates = [];
    if (text) {
      text.split(/[,、\s]+/).filter(Boolean).forEach(s => {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          d.setHours(0,0,0,0);
          dates.push(d);
        }
      });
    }
    if (from && to) {
      const f = new Date(from); f.setHours(0,0,0,0);
      const t = new Date(to);   t.setHours(0,0,0,0);
      if (f.getTime() !== t.getTime() || dates.length === 0) {
        for (let d = new Date(f); d <= t; d.setDate(d.getDate()+1)) {
          if (skipWeekend && isOffDay(d)) continue;
          dates.push(new Date(d));
        }
      }
    }
    if (dates.length === 0) {
      alert('日付を入力するか範囲を選択してください');
      return;
    }
    // 重複排除
    const uniq = Array.from(new Map(dates.map(d => [fmtYmd(d), d])).values())
                      .sort((a,b) => a - b);
    await bulkPunch(uniq, userTimes, logEl);
  };

  console.log('[iQube Helper] ready');
})();

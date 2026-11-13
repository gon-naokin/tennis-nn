// 画面共通の小道具：名前解決、HTML 断片、ナビ、トースト
const UI = (() => {
  let data = { members: [], events: [], matches: [], role: '' };
  const memberById = new Map();

  function setData(d) {
    data = d;
    memberById.clear();
    d.members.forEach(m => memberById.set(m.member_id, m));
  }
  function getData() { return data; }

  /** 新しく登録された人を画面のデータに足す */
  function addMembers(list) {
    list.forEach(m => {
      if (memberById.has(m.member_id)) return;
      data.members.push(m);
      memberById.set(m.member_id, m);
    });
  }

  /** 名前の比較用キー。全角半角・空白・大文字小文字の違いを無視する */
  function nameKey(s) {
    return String(s === undefined || s === null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  /** 入力された名前からメンバーを探す。表示名、次に名前の順に見る。同名が複数なら null */
  function findMember(text) {
    const key = nameKey(text);
    const hit = list => (list.length === 1 ? list[0] : null);
    return hit(data.members.filter(m => nameKey(m.display_name) === key)) ||
      hit(data.members.filter(m => nameKey(m.name) === key));
  }

  function member(id) { return memberById.get(id); }
  function name(id) {
    const m = memberById.get(id);
    return m ? m.display_name : id;
  }

  /** 名前順に並べたメンバー（試合に出た人と active の人） */
  function sortedMembers() {
    const played = new Set();
    data.matches.forEach(m => Stats.sides(m).A.concat(Stats.sides(m).B).forEach(id => played.add(id)));
    return data.members
      .filter(m => m.active || played.has(m.member_id))
      .slice()
      .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'ja'));
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pct(rate) {
    return rate === null || rate === undefined ? '–' : Math.round(rate * 100) + '%';
  }

  function fmtDate(s) {
    return s ? String(s).replace(/-/g, '/') : '';
  }

  /** 今日の日付（端末の時刻で YYYY-MM-DD） */
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function typeLabel(t) {
    return t === 'S' ? 'シングルス' : 'ダブルス';
  }

  function typeBadge(t) {
    return '<span class="badge type-' + (t === 'S' ? 'S' : 'D') + '">' + typeLabel(t) + '</span>';
  }

  /** 試合の結果に対応するキャラ（A 側の勝ち=クマ、B 側の勝ち=カエル、引き分け=風船） */
  function resultImg(r) {
    return 'img/' + (r === 'A' ? 'bear' : r === 'B' ? 'frog' : 'balloon') + '.png';
  }

  /** 選手ごとの相棒キャラ。member_id の番号で決まるので毎回同じ */
  function avatarSrc(id) {
    const pool = ['cat', 'dog', 'balloon', 'girl', 'star'];
    const n = parseInt(String(id).replace(/^\D+/, ''), 10) || 0;
    return 'img/' + pool[n % pool.length] + '.png';
  }

  /** データが無いときの表示 */
  function emptyHTML(msg) {
    return '<div class="empty"><img src="img/frog-sleep.png" alt="" class="empty-img"><p>' + esc(msg) + '</p></div>';
  }

  /** 登録成功時に星を画面に飛ばす */
  function celebrate() {
    const star = document.createElement('img');
    star.src = 'img/star.png';
    star.alt = '';
    star.className = 'fly-star';
    star.addEventListener('animationend', () => star.remove());
    document.body.appendChild(star);
  }

  /** 新しい順（日付 → match_id） */
  function sortMatches(list) {
    return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.match_id - a.match_id);
  }

  /** 片側の名前（ダブルスは「・」でつなぐ）。hl に member_id を渡すとその人を太字にする */
  function sideHTML(ids, hl) {
    return ids.map(id => (id === hl ? '<b>' + esc(name(id)) + '</b>' : esc(name(id)))).join('・');
  }

  /** 試合 1 件の行。opts.highlight に member_id を渡すとその人を太字にする */
  function matchRowHTML(m, opts) {
    const hl = (opts && opts.highlight) || null;
    const s = Stats.sides(m);
    const cls = m.result === 'A' ? 'win-a' : m.result === 'B' ? 'win-b' : 'draw';
    return (
      '<li class="match ' + cls + '">' +
      '<div class="match-meta">' + esc(fmtDate(m.date)) + ' ' + typeBadge(m.type) + '</div>' +
      '<div class="match-line">' +
      '<span class="side side-a">' + sideHTML(s.A, hl) + '</span>' +
      '<span class="score">' + esc(m.a_games) + '-' + esc(m.b_games) + '</span>' +
      '<span class="side side-b">' + sideHTML(s.B, hl) + '</span>' +
      '</div>' +
      (m.note ? '<div class="match-note">' + esc(m.note) + '</div>' : '') +
      '</li>'
    );
  }

  /** 対戦成績の表（相手別・パートナー別） */
  function recordTable(list, label) {
    if (!list.length) return '<p class="empty">まだありません</p>';
    return (
      '<div class="table-wrap"><table>' +
      '<thead><tr><th class="l">' + esc(label) + '</th><th>試合</th><th>勝</th><th>負</th><th>分</th></tr></thead><tbody>' +
      list.map(r =>
        '<tr><td class="l"><a href="players.html#' + encodeURIComponent(r.id) + '">' + esc(name(r.id)) + '</a></td>' +
        '<td class="num">' + r.played + '</td><td class="num">' + r.W + '</td>' +
        '<td class="num">' + r.L + '</td><td class="num">' + r.D + '</td></tr>'
      ).join('') +
      '</tbody></table></div>'
    );
  }

  function renderNav(page, role) {
    const nav = document.getElementById('nav');
    if (nav) {
      const items = [
        ['index.html', '戦績'],
        ['players.html', '個人'],
        ['matches.html', '試合'],
      ];
      if (role === 'admin') items.push(['input.html', '入力']);
      nav.innerHTML =
        items.map(([href, label]) =>
          '<a href="' + href + '"' + (href === page ? ' class="active" aria-current="page"' : '') + '>' + label + '</a>'
        ).join('') +
        '<button type="button" class="link nav-logout" id="nav-logout">ログアウト</button>';
      document.getElementById('nav-logout').addEventListener('click', () => Auth.logout());
    }
    const banner = document.getElementById('mock-banner');
    if (banner) banner.hidden = !Api.isMock();
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /** select に option を流し込む。items: [{value, label}] */
  function fillSelect(sel, items, placeholder) {
    sel.innerHTML =
      (placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      items.map(it => '<option value="' + esc(it.value) + '">' + esc(it.label) + '</option>').join('');
  }

  /** シングルス／ダブルスの切り替えボタン。onChange(type) を呼ぶ */
  function bindSeg(id, onChange) {
    const btns = document.querySelectorAll('#' + id + ' button');
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.classList.toggle('on', x === b));
      onChange(b.dataset.type);
    }));
  }

  function setSeg(id, type) {
    document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x.dataset.type === type));
  }

  return {
    setData, getData, addMembers, nameKey, findMember, member, name, sortedMembers,
    esc, pct, fmtDate, today, typeLabel, typeBadge, sortMatches, sideHTML, matchRowHTML, recordTable,
    renderNav, toast, fillSelect, bindSeg, setSeg, resultImg, avatarSrc, emptyHTML, celebrate,
  };
})();

// 画面共通の小道具：名前解決、HTML 断片、ナビ、トースト
const UI = (() => {
  let data = { members: [], events: [], matches: [], role: '' };
  const memberById = new Map();
  const eventById = new Map();

  function setData(d) {
    data = d;
    memberById.clear();
    eventById.clear();
    d.members.forEach(m => memberById.set(m.member_id, m));
    d.events.forEach(e => eventById.set(e.event_id, e));
  }
  function getData() { return data; }

  function member(id) { return memberById.get(id); }
  function name(id) {
    const m = memberById.get(id);
    return m ? m.display_name : id;
  }
  function pair(a, b) { return name(a) + '・' + name(b); }
  function event(id) { return eventById.get(id); }
  function eventTitle(id) {
    const e = eventById.get(id);
    return e ? e.title : id;
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

  function resultText(r) {
    return r === 'H' ? 'H の勝ち' : r === 'M' ? 'M の勝ち' : '引き分け';
  }

  function badge(r) {
    const label = r === 'D' ? '分' : r;
    return '<span class="badge badge-' + esc(r) + '">' + esc(label) + '</span>';
  }

  function teamBadge(team) {
    return '<span class="badge badge-' + esc(team) + '">' + esc(team) + '</span>';
  }

  /** 試合の結果に対応するキャラ（H=クマ、M=カエル、引き分け=風船） */
  function resultImg(r) {
    return 'img/' + (r === 'H' ? 'bear' : r === 'M' ? 'frog' : 'balloon') + '.png';
  }

  /** 選手ごとの相棒キャラ。member_id の番号で決まるので毎回同じ */
  function avatarSrc(id) {
    const pool = ['cat', 'dog', 'balloon', 'girl', 'star'];
    const n = parseInt(String(id).slice(1), 10) || 0;
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

  /** 試合 1 件の行。opts.highlight に member_id を渡すとその人を太字にする */
  function matchRowHTML(m, opts) {
    const hl = (opts && opts.highlight) || null;
    const nm = id => (id === hl ? '<b>' + esc(name(id)) + '</b>' : esc(name(id)));
    const cls = m.result === 'H' ? 'win-h' : m.result === 'M' ? 'win-m' : 'draw';
    return (
      '<li class="match ' + cls + '">' +
      '<div class="match-meta">' + esc(fmtDate(m.date)) + ' <span class="muted">' + esc(eventTitle(m.event_id)) + '</span></div>' +
      '<div class="match-line">' +
      '<span class="side side-h">' + nm(m.h_p1) + '・' + nm(m.h_p2) + '</span>' +
      '<span class="score">' + esc(m.h_games) + '-' + esc(m.m_games) + '</span>' +
      '<span class="side side-m">' + nm(m.m_p1) + '・' + nm(m.m_p2) + '</span>' +
      '</div>' +
      (m.note ? '<div class="match-note">' + esc(m.note) + '</div>' : '') +
      '</li>'
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

  return {
    setData, getData, member, name, pair, event, eventTitle,
    esc, pct, fmtDate, resultText, badge, teamBadge, sortMatches, matchRowHTML,
    renderNav, toast, fillSelect, resultImg, avatarSrc, emptyHTML, celebrate,
  };
})();

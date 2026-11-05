// サンプルデータ（CONFIG.GAS_URL が空のときだけ使われる）
// パスワードは何でも通る。'admin' と入れると幹事扱いになる。
// 入力した試合はこのタブの sessionStorage に残る（タブを閉じると消える）。
const Mock = (() => {
  // ダミー名のメンバー（H 11 名、M 14 名）。実名は公開リポジトリに置かない
  const members = [];
  const addMembers = (team, count) => {
    for (let i = 1; i <= count; i++) {
      const name = team + '選手' + i;
      members.push({ member_id: team + ('0' + i).slice(-2), team, name, display_name: name, active: true });
    }
  };
  addMembers('H', 11);
  addMembers('M', 14);

  const events = [
    { event_id: 'E001', date: '2026-05-17', title: '第1回交流戦（サンプル）', venue: '', note: '' },
    { event_id: 'E002', date: '2026-09-06', title: '第2回交流戦（サンプル）', venue: '', note: '' },
  ];

  const seed = [
    [1, 'E001', 'H01', 'H02', 'M01', 'M03', 6, 3],
    [2, 'E001', 'H03', 'H04', 'M02', 'M04', 4, 6],
    [3, 'E001', 'H05', 'H06', 'M05', 'M06', 5, 5],
    [4, 'E001', 'H07', 'H08', 'M07', 'M08', 6, 2],
    [5, 'E001', 'H09', 'H10', 'M09', 'M10', 3, 6],
    [6, 'E001', 'H11', 'H01', 'M11', 'M12', 6, 4],
    [7, 'E001', 'H02', 'H03', 'M13', 'M14', 2, 6],
    [8, 'E002', 'H04', 'H05', 'M01', 'M02', 6, 1],
    [9, 'E002', 'H06', 'H07', 'M03', 'M05', 5, 5],
    [10, 'E002', 'H08', 'H09', 'M04', 'M06', 6, 4],
    [11, 'E002', 'H10', 'H11', 'M07', 'M09', 1, 6],
    [12, 'E002', 'H01', 'H03', 'M08', 'M10', 6, 3],
    [13, 'E002', 'H02', 'H04', 'M11', 'M13', 4, 6],
    [14, 'E002', 'H05', 'H08', 'M12', 'M14', 6, 0],
  ].map(([id, ev, h1, h2, m1, m2, hg, mg]) => ({
    match_id: id, event_id: ev,
    date: events.filter(e => e.event_id === ev)[0].date,
    h_p1: h1, h_p2: h2, m_p1: m1, m_p2: m2,
    h_games: hg, m_games: mg,
    result: hg === 6 ? 'H' : mg === 6 ? 'M' : 'D',
    entered_by: 'サンプル', note: '',
  }));

  const STORE = 'th_mock_matches';

  function load() {
    try {
      const s = sessionStorage.getItem(STORE);
      if (s) return JSON.parse(s);
    } catch (e) { /* 使えない環境では seed を返す */ }
    return seed.map(m => Object.assign({}, m));
  }

  function save(list) {
    try { sessionStorage.setItem(STORE, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function delay(value) {
    return new Promise(resolve => setTimeout(() => resolve(value), 250));
  }

  function validScore(h, m) {
    return (h === 6 && m >= 0 && m <= 4) || (m === 6 && h >= 0 && h <= 4) || (h === 5 && m === 5);
  }

  function handle(payload) {
    const key = String(payload.key || '').trim();
    if (!key) return delay({ ok: false, error: 'auth' });
    const role = key === 'admin' ? 'admin' : 'viewer';
    const matches = load();

    if (payload.action === 'getAll') {
      return delay({ ok: true, role, members, events, matches });
    }

    if (payload.action === 'addMatch') {
      if (role !== 'admin') return delay({ ok: false, error: 'auth' });
      const m = payload.match || {};
      const h = Number(m.h_games);
      const g = Number(m.m_games);
      const ev = events.filter(e => e.event_id === m.event_id)[0];
      if (!ev) return delay({ ok: false, error: '開催回が見つかりません' });
      if (!validScore(h, g)) return delay({ ok: false, error: 'スコアが不正です' });
      if (m.h_p1 === m.h_p2 || m.m_p1 === m.m_p2) return delay({ ok: false, error: '同じ人がペアになっています' });
      const id = matches.reduce((x, r) => Math.max(x, r.match_id), 0) + 1;
      matches.push({
        match_id: id, event_id: m.event_id, date: ev.date,
        h_p1: m.h_p1, h_p2: m.h_p2, m_p1: m.m_p1, m_p2: m.m_p2,
        h_games: h, m_games: g,
        result: h === 6 ? 'H' : g === 6 ? 'M' : 'D',
        entered_by: m.entered_by || '', note: m.note || '',
      });
      save(matches);
      return delay({ ok: true, match_id: id });
    }

    return delay({ ok: false, error: 'unknown_action' });
  }

  return { handle };
})();

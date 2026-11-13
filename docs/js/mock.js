// サンプルデータ（CONFIG.GAS_URL が空のときだけ使われる）
// パスワードは何でも通る。'admin' と入れると幹事扱いになる。
// 入力した試合と新しく登録した人はこのタブの sessionStorage に残る（タブを閉じると消える）。
const Mock = (() => {
  // ダミー名のメンバー 12 名。実名は公開リポジトリに置かない
  const members = [];
  for (let i = 1; i <= 12; i++) {
    members.push({ member_id: 'P' + ('0' + i).slice(-2), name: '選手' + i, display_name: '選手' + i, active: true });
  }

  const events = [];

  // [id, 日付, 種目, a1, a2, b1, b2, A のゲーム, B のゲーム]
  const seed = [
    [1, '2026-09-06', 'D', 'P01', 'P02', 'P03', 'P04', 6, 3],
    [2, '2026-09-06', 'D', 'P05', 'P06', 'P07', 'P08', 4, 6],
    [3, '2026-09-06', 'S', 'P01', '', 'P09', '', 6, 2],
    [4, '2026-09-06', 'S', 'P10', '', 'P11', '', 5, 5],
    [5, '2026-09-20', 'D', 'P09', 'P10', 'P11', 'P12', 6, 4],
    [6, '2026-09-20', 'S', 'P02', '', 'P03', '', 3, 6],
    [7, '2026-09-20', 'S', 'P04', '', 'P05', '', 6, 1],
    [8, '2026-10-04', 'D', 'P01', 'P03', 'P02', 'P04', 6, 0],
    [9, '2026-10-04', 'D', 'P06', 'P07', 'P05', 'P08', 5, 5],
    [10, '2026-10-04', 'S', 'P01', '', 'P03', '', 6, 4],
    [11, '2026-10-18', 'S', 'P06', '', 'P12', '', 2, 6],
    [12, '2026-10-18', 'D', 'P08', 'P09', 'P10', 'P11', 6, 3],
    [13, '2026-11-01', 'S', 'P01', '', 'P02', '', 4, 6],
    [14, '2026-11-01', 'D', 'P12', 'P01', 'P06', 'P04', 6, 2],
    [15, '2026-11-08', 'S', 'P09', '', 'P03', '', 6, 3],
    [16, '2026-11-08', 'D', 'P02', 'P05', 'P07', 'P10', 1, 6],
  ].map(([id, date, type, a1, a2, b1, b2, ag, bg]) => ({
    match_id: id, date, type, a1, a2, b1, b2,
    a_games: ag, b_games: bg,
    result: ag === 6 ? 'A' : bg === 6 ? 'B' : 'D',
    entered_by: 'サンプル', note: '', event_id: '',
  }));

  const STORE = 'th_mock2_matches';
  const STORE_MEMBERS = 'th_mock2_members';

  function load(key, fallback) {
    try {
      const s = sessionStorage.getItem(key);
      if (s) return JSON.parse(s);
    } catch (e) { /* 使えない環境では初期値を返す */ }
    return fallback();
  }

  function save(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function delay(value) {
    return new Promise(resolve => setTimeout(() => resolve(value), 250));
  }

  function validScore(a, b) {
    return (a === 6 && b >= 0 && b <= 4) || (b === 6 && a >= 0 && a <= 4) || (a === 5 && b === 5);
  }

  function nameKey(s) {
    return String(s === undefined || s === null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  /** ID か名前を受け取り、member_id か新しい人の情報を返す（Code.gs の pickMember と同じ考え方） */
  function pickMember(list, value) {
    const v = String(value || '').trim();
    if (!v) return { error: '名前が入力されていません' };
    if (/^[A-Z]\d+$/i.test(v)) {
      const byId = list.filter(m => m.member_id.toUpperCase() === v.toUpperCase())[0];
      return byId ? { id: byId.member_id } : { error: 'メンバーが見つかりません: ' + v };
    }
    const key = nameKey(v);
    const shown = list.filter(m => nameKey(m.display_name) === key);
    if (shown.length === 1) return { id: shown[0].member_id };
    const named = list.filter(m => nameKey(m.name) === key);
    if (named.length === 1) return { id: named[0].member_id };
    if (shown.length || named.length) return { error: '同じ名前の人が複数います: ' + v };
    if (/^[=+\-@']/.test(v) || v.length > 20) return { error: '使えない名前です: ' + v };
    return { name: v, key };
  }

  function handle(payload) {
    const key = String(payload.key || '').trim();
    if (!key) return delay({ ok: false, error: 'auth' });
    const role = key === 'admin' ? 'admin' : 'viewer';
    const matches = load(STORE, () => seed.map(m => Object.assign({}, m)));
    const added = load(STORE_MEMBERS, () => []);
    const all = members.concat(added);

    if (payload.action === 'getAll') {
      return delay({ ok: true, role, members: all, events, matches });
    }

    if (payload.action === 'addMatch') {
      if (role !== 'admin') return delay({ ok: false, error: 'auth' });
      const m = payload.match || {};
      const type = m.type;
      if (type !== 'S' && type !== 'D') return delay({ ok: false, error: '種目が不正です' });
      const a = Number(m.a_games);
      const b = Number(m.b_games);
      if (!validScore(a, b)) return delay({ ok: false, error: 'スコアが不正です' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return delay({ ok: false, error: '日付が不正です' });

      const keys = type === 'S' ? ['a1', 'b1'] : ['a1', 'a2', 'b1', 'b2'];
      const picks = keys.map(k => pickMember(all, m[k]));
      const bad = picks.filter(p => p.error)[0];
      if (bad) return delay({ ok: false, error: bad.error });
      const tags = picks.map(p => p.id || p.key);
      if (new Set(tags).size !== tags.length) return delay({ ok: false, error: '同じ人が 2 回入っています' });

      const created = [];
      const ids = {};
      picks.forEach((p, i) => {
        if (p.id) { ids[keys[i]] = p.id; return; }
        const nums = all.map(x => (/^P(\d+)$/.exec(x.member_id) || [0, 0])[1] * 1);
        const n = Math.max.apply(null, nums.concat([0])) + 1;
        const mb = { member_id: 'P' + ('0' + n).slice(-2), name: p.name, display_name: p.name, active: true };
        all.push(mb);
        added.push(mb);
        created.push(mb);
        ids[keys[i]] = mb.member_id;
      });
      save(STORE_MEMBERS, added);

      const id = matches.reduce((x, r) => Math.max(x, r.match_id), 0) + 1;
      matches.push({
        match_id: id, date: m.date, type,
        a1: ids.a1, a2: ids.a2 || '', b1: ids.b1, b2: ids.b2 || '',
        a_games: a, b_games: b,
        result: a === 6 ? 'A' : b === 6 ? 'B' : 'D',
        entered_by: m.entered_by || '', note: m.note || '', event_id: '',
      });
      save(STORE, matches);
      return delay({ ok: true, match_id: id, ids: [ids.a1, ids.a2 || '', ids.b1, ids.b2 || ''], created });
    }

    return delay({ ok: false, error: 'unknown_action' });
  }

  return { handle };
})();

// 集計ロジック（DESIGN.md §6）。入力は getAll の matches（deleted 除外済み）。
const Stats = (() => {
  function blank() {
    return { played: 0, W: 0, L: 0, D: 0, gf: 0, ga: 0 };
  }

  /** そのチームから見た 1 試合の結果 */
  function outcomeFor(team, m) {
    if (m.result === 'D') return 'D';
    return m.result === team ? 'W' : 'L';
  }

  function playersOf(m) {
    return [
      { id: m.h_p1, team: 'H' }, { id: m.h_p2, team: 'H' },
      { id: m.m_p1, team: 'M' }, { id: m.m_p2, team: 'M' },
    ];
  }

  /** チーム戦績 */
  function teamRecord(matches) {
    const r = { H: 0, M: 0, D: 0, hGames: 0, mGames: 0, total: matches.length };
    matches.forEach(m => {
      r[m.result] += 1;
      r.hGames += m.h_games;
      r.mGames += m.m_games;
    });
    return r;
  }

  /** 開催回ごとの内訳（新しい順） */
  function byEvent(matches, events) {
    const map = new Map();
    events.forEach(e => map.set(e.event_id, { event: e, H: 0, M: 0, D: 0, hGames: 0, mGames: 0, total: 0 }));
    matches.forEach(m => {
      let row = map.get(m.event_id);
      if (!row) {
        row = { event: { event_id: m.event_id, title: m.event_id, date: m.date }, H: 0, M: 0, D: 0, hGames: 0, mGames: 0, total: 0 };
        map.set(m.event_id, row);
      }
      row[m.result] += 1;
      row.hGames += m.h_games;
      row.mGames += m.m_games;
      row.total += 1;
    });
    return Array.from(map.values()).sort((a, b) => (b.event.date || '').localeCompare(a.event.date || ''));
  }

  /** 個人成績。member_id → { member, played, W, L, D, gf, ga, rate } */
  function playerStats(matches, members) {
    const stats = new Map();
    members.forEach(mb => stats.set(mb.member_id, Object.assign({ member: mb }, blank())));

    matches.forEach(m => {
      playersOf(m).forEach(p => {
        let s = stats.get(p.id);
        if (!s) {
          // members に無い ID が試合に出てきても落ちないようにする
          s = Object.assign({ member: { member_id: p.id, team: p.team, name: p.id, display_name: p.id, active: true } }, blank());
          stats.set(p.id, s);
        }
        s.played += 1;
        s[outcomeFor(p.team, m)] += 1;
        s.gf += p.team === 'H' ? m.h_games : m.m_games;
        s.ga += p.team === 'H' ? m.m_games : m.h_games;
      });
    });

    // 勝率 = 勝 ÷ 試合数（引き分けも分母に含める）
    stats.forEach(s => { s.rate = s.played ? s.W / s.played : null; });
    return stats;
  }

  /** 個人の詳細：対戦相手別・パートナー別・出場試合 */
  function playerDetail(matches, memberId) {
    const opponents = new Map();
    const partners = new Map();
    const list = [];

    matches.forEach(m => {
      const ps = playersOf(m);
      const me = ps.filter(p => p.id === memberId)[0];
      if (!me) return;
      const o = outcomeFor(me.team, m);
      list.push({ match: m, outcome: o });
      ps.forEach(p => {
        if (p.id === memberId) return;
        const target = p.team === me.team ? partners : opponents;
        let r = target.get(p.id);
        if (!r) { r = { id: p.id, played: 0, W: 0, L: 0, D: 0 }; target.set(p.id, r); }
        r.played += 1;
        r[o] += 1;
      });
    });

    const order = (a, b) => b.played - a.played || b.W - a.W || a.id.localeCompare(b.id);
    return {
      opponents: Array.from(opponents.values()).sort(order),
      partners: Array.from(partners.values()).sort(order),
      matches: list,
    };
  }

  return { teamRecord, byEvent, playerStats, playerDetail, outcomeFor };
})();

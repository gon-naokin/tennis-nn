// 集計ロジック（DESIGN.md §6）。入力は getAll の matches（deleted 除外済み）。
// 試合は A 側と B 側の対戦。シングルスは a1 対 b1、ダブルスは a1・a2 対 b1・b2。
const Stats = (() => {
  function blank() {
    return { played: 0, W: 0, L: 0, D: 0, gf: 0, ga: 0 };
  }

  /** 試合の両側の member_id */
  function sides(m) {
    const A = m.type === 'D' ? [m.a1, m.a2] : [m.a1];
    const B = m.type === 'D' ? [m.b1, m.b2] : [m.b1];
    return { A: A.filter(Boolean), B: B.filter(Boolean) };
  }

  /** その人がどちら側か（出ていなければ null） */
  function sideOf(m, id) {
    const s = sides(m);
    return s.A.indexOf(id) >= 0 ? 'A' : s.B.indexOf(id) >= 0 ? 'B' : null;
  }

  function hasPlayer(m, id) {
    return sideOf(m, id) !== null;
  }

  /** その側から見た 1 試合の結果 */
  function outcomeFor(side, m) {
    if (m.result === 'D') return 'D';
    return m.result === side ? 'W' : 'L';
  }

  /** 種目で絞る。type が 'S' か 'D' 以外なら全部 */
  function byType(matches, type) {
    return type === 'S' || type === 'D' ? matches.filter(m => m.type === type) : matches;
  }

  /** 全体の数字 */
  function summary(matches) {
    const people = new Set();
    let S = 0, D = 0, last = '';
    matches.forEach(m => {
      if (m.type === 'S') S += 1; else D += 1;
      if ((m.date || '') > last) last = m.date;
      const s = sides(m);
      s.A.concat(s.B).forEach(id => people.add(id));
    });
    return { total: matches.length, S, D, last, people: people.size };
  }

  /** 日付ごとの内訳（新しい順）。[{ date, total, S, D, people }] */
  function byDate(matches) {
    const map = new Map();
    matches.forEach(m => {
      const d = m.date || '';
      let row = map.get(d);
      if (!row) { row = { date: d, total: 0, S: 0, D: 0, ids: new Set() }; map.set(d, row); }
      row.total += 1;
      if (m.type === 'S') row.S += 1; else row.D += 1;
      const s = sides(m);
      s.A.concat(s.B).forEach(id => row.ids.add(id));
    });
    return Array.from(map.values())
      .map(r => ({ date: r.date, total: r.total, S: r.S, D: r.D, people: r.ids.size }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** 個人成績。member_id → { member, played, W, L, D, gf, ga, rate } */
  function playerStats(matches, members) {
    const stats = new Map();
    members.forEach(mb => stats.set(mb.member_id, Object.assign({ member: mb }, blank())));

    matches.forEach(m => {
      const s = sides(m);
      ['A', 'B'].forEach(side => {
        s[side].forEach(id => {
          let r = stats.get(id);
          if (!r) {
            // members に無い ID が試合に出てきても落ちないようにする
            r = Object.assign({ member: { member_id: id, name: id, display_name: id, active: true } }, blank());
            stats.set(id, r);
          }
          r.played += 1;
          r[outcomeFor(side, m)] += 1;
          r.gf += side === 'A' ? m.a_games : m.b_games;
          r.ga += side === 'A' ? m.b_games : m.a_games;
        });
      });
    });

    // 勝率 = 勝 ÷ 試合数（引き分けも分母に含める）
    stats.forEach(r => { r.rate = r.played ? r.W / r.played : null; });
    return stats;
  }

  /** 並べ方：勝率 → 勝ち数 → 試合数 */
  function compareRate(a, b) {
    const ra = a.rate === null ? -1 : a.rate;
    const rb = b.rate === null ? -1 : b.rate;
    return (rb - ra) || (b.W - a.W) || (b.played - a.played) ||
      String(a.member.display_name).localeCompare(String(b.member.display_name), 'ja', { numeric: true });
  }

  /** 勝率ランキング。試合数が min 未満の人は外す */
  function ranking(matches, members, min) {
    return Array.from(playerStats(matches, members).values())
      .filter(r => r.played >= (min || 1))
      .sort(compareRate);
  }

  /** 個人の詳細：対戦相手別・パートナー別・出場試合 */
  function playerDetail(matches, memberId) {
    const opponents = new Map();
    const partners = new Map();
    const list = [];

    matches.forEach(m => {
      const side = sideOf(m, memberId);
      if (!side) return;
      const o = outcomeFor(side, m);
      list.push({ match: m, outcome: o });
      const s = sides(m);
      const tally = (target, id) => {
        let r = target.get(id);
        if (!r) { r = { id: id, played: 0, W: 0, L: 0, D: 0 }; target.set(id, r); }
        r.played += 1;
        r[o] += 1;
      };
      s[side].forEach(id => { if (id !== memberId) tally(partners, id); });
      s[side === 'A' ? 'B' : 'A'].forEach(id => tally(opponents, id));
    });

    const order = (a, b) => b.played - a.played || b.W - a.W || a.id.localeCompare(b.id);
    return {
      opponents: Array.from(opponents.values()).sort(order),
      partners: Array.from(partners.values()).sort(order),
      matches: list,
    };
  }

  return { sides, sideOf, hasPlayer, outcomeFor, byType, summary, byDate, playerStats, compareRate, ranking, playerDetail };
})();

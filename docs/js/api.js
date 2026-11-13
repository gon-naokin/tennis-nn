// GAS Web アプリへの通信。GAS_URL が空ならサンプルデータ（Mock）に流す。
const Api = (() => {
  function isMock() {
    return !CONFIG.GAS_URL;
  }

  async function call(payload) {
    if (isMock()) return Mock.handle(payload);

    let res;
    try {
      // Content-Type を付けない（text/plain 扱い）。application/json にするとプリフライトが飛び GAS が応答できない。
      res = await fetch(CONFIG.GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    try {
      return await res.json();
    } catch (e) {
      return { ok: false, error: 'bad_response' };
    }
  }

  /** 旧版（H vs M）の GAS が返す形でも読めるようにする。H 側を A 側、M 側を B 側として扱う */
  function normalize(res) {
    if (!res || !res.ok || !Array.isArray(res.matches)) return res;
    res.matches = res.matches.map(m => {
      if (m.a1 !== undefined) return m;
      return Object.assign({}, m, {
        type: 'D',
        a1: m.h_p1, a2: m.h_p2, b1: m.m_p1, b2: m.m_p2,
        a_games: m.h_games, b_games: m.m_games,
        result: m.result === 'H' ? 'A' : m.result === 'M' ? 'B' : 'D',
      });
    });
    return res;
  }

  return {
    isMock,
    getAll: key => call({ action: 'getAll', key }).then(normalize),
    addMatch: (key, match) => call({ action: 'addMatch', key, match }),
  };
})();

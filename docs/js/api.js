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

  return {
    isMock,
    getAll: key => call({ action: 'getAll', key }),
    addMatch: (key, match) => call({ action: 'addMatch', key, match }),
  };
})();

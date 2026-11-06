// 入り口パスワードと role の保持。
// パスワードの照合は GAS 側（getAll）で行う。ここでは結果を覚えるだけ。
const Auth = (() => {
  const K_KEY = 'th_key';
  const K_ROLE = 'th_role';
  const K_CACHE = 'th_cache';
  const CACHE_MS = 60 * 1000; // 画面間の移動で毎回 GAS を呼ばないための短いキャッシュ

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  function key() { return ls.get(K_KEY) || ''; }
  function role() { return ls.get(K_ROLE) || ''; }
  function remember(k, r) { ls.set(K_KEY, k); ls.set(K_ROLE, r); }
  function forget() { ls.del(K_KEY); ls.del(K_ROLE); ss.del(K_CACHE); }

  function readCache() {
    try {
      const c = JSON.parse(ss.get(K_CACHE) || 'null');
      if (c && Date.now() - c.t < CACHE_MS) return c.data;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeCache(data) { ss.set(K_CACHE, JSON.stringify({ t: Date.now(), data })); }
  function invalidate() { ss.del(K_CACHE); }

  function errorText(code) {
    switch (code) {
      case 'network': return 'サーバーに接続できませんでした。電波の状態を確認して、もう一度お試しください。';
      case 'bad_response': return 'サーバーの応答を読めませんでした。config.js の GAS_URL が正しいか確認してください。';
      case 'bad_request': return 'リクエストの形式が不正です。';
      default: return code || 'エラーが発生しました。';
    }
  }

  function gateHTML(message, retry) {
    const mockNote = Api.isMock()
      ? '<p class="gate-note">サンプルデータモードです。パスワードは何でも通ります（<code>admin</code> で幹事扱い）。</p>'
      : '';
    return (
      '<div class="gate-card">' +
      '<div class="gate-cast" aria-hidden="true">' +
      '<img src="img/bear.png" alt=""><img src="img/cat.png" alt=""><img src="img/frog.png" alt="">' +
      '</div>' +
      '<h1 class="gate-title">' + UI.esc(CONFIG.APP_TITLE) + '</h1>' +
      '<p class="gate-lead">パスワードを入力してください</p>' +
      '<form id="gate-form" autocomplete="off">' +
      '<input id="gate-pass" type="password" inputmode="text" autocomplete="current-password" placeholder="パスワード" required>' +
      '<button type="submit" id="gate-submit">' + (retry ? '再試行' : '入る') + '</button>' +
      '</form>' +
      (message ? '<p class="gate-error" role="alert">' + UI.esc(message) + '</p>' : '') +
      mockNote +
      '</div>'
    );
  }

  /**
   * 各ページの最初に呼ぶ。パスワードが通ればデータを resolve し、ナビを描画する。
   * opts.page         現在のページのファイル名（ナビの強調用）
   * opts.requireAdmin 幹事専用ページなら true（閲覧用で来たら index に戻す）
   */
  function boot(opts) {
    const page = opts.page;
    const requireAdmin = !!opts.requireAdmin;
    const gate = document.getElementById('gate');
    const app = document.getElementById('app');

    return new Promise(resolve => {
      function showGate(message, keepKey) {
        app.hidden = true;
        gate.hidden = false;
        gate.innerHTML = gateHTML(message, keepKey);
        const form = document.getElementById('gate-form');
        const input = document.getElementById('gate-pass');
        if (keepKey) input.value = key();
        form.addEventListener('submit', ev => {
          ev.preventDefault();
          const k = input.value.trim();
          if (!k) return;
          attempt(k, true);
        });
        setTimeout(() => input.focus(), 0);
      }

      // パスワードを覚えている端末で GAS の応答を待つ間の画面
      function showLoading() {
        app.hidden = true;
        gate.hidden = false;
        gate.innerHTML =
          '<div class="loader" role="status"><img src="img/cat.png" alt=""><p>データを取りに行っています…</p></div>';
      }

      function setBusy(busy) {
        const btn = document.getElementById('gate-submit');
        if (btn) { btn.disabled = busy; btn.textContent = busy ? '確認中…' : '入る'; }
      }

      async function attempt(k, fromForm) {
        let data = fromForm ? null : readCache();
        if (!data) {
          if (!fromForm) showLoading();
          setBusy(true);
          const res = await Api.getAll(k);
          setBusy(false);
          if (!res.ok) {
            if (res.error === 'auth') {
              forget();
              showGate(fromForm ? 'パスワードが違います' : '', false);
            } else {
              showGate(errorText(res.error), true);
            }
            return;
          }
          data = res;
          writeCache(data);
        }
        remember(k, data.role);

        if (requireAdmin && data.role !== 'admin') {
          location.replace('index.html');
          return;
        }

        UI.setData(data);
        UI.renderNav(page, data.role);
        gate.hidden = true;
        app.hidden = false;
        resolve(data);
      }

      const k = key();
      if (k) attempt(k, false);
      else showGate('', false);
    });
  }

  /** キャッシュを捨てて取り直す（入力後など） */
  async function refresh() {
    invalidate();
    const res = await Api.getAll(key());
    if (res.ok) {
      writeCache(res);
      UI.setData(res);
    }
    return res;
  }

  function logout() {
    forget();
    location.href = 'index.html';
  }

  return { boot, key, role, logout, invalidate, refresh };
})();

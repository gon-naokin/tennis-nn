/**
 * H vs M テニス交流戦 戦績アプリ — Google Apps Script（API 本体）
 *
 * セットアップ手順は README.md を参照。
 *   1. スプレッドシートの「拡張機能 → Apps Script」を開き、このファイルの内容を貼り付けて保存
 *   2. エディタ上で setup() を実行（初回は権限の承認が出る）。members は空で作られ、試合入力のときに名前が自動で登録される
 *   3. プロジェクトの設定 → スクリプト プロパティ に VIEWER_PASS / ADMIN_PASS を登録
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」／実行ユーザー「自分」／アクセス「全員」
 *   5. 発行された URL を docs/js/config.js の GAS_URL に貼る
 *
 * API（すべて POST、本文は JSON 文字列）
 *   { action: 'getAll',   key }         → { ok, role, members, events, matches }
 *   { action: 'addMatch', key, match }  → { ok, match_id, ids, created }   ※ key は ADMIN_PASS のみ
 *     match の h_p1 / h_p2 / m_p1 / m_p2 は member_id か名前。初めての名前は members に追加し、created で返す
 *   失敗時は { ok: false, error: '...' }。error が 'auth' ならパスワード不一致。
 */

const TZ = 'Asia/Tokyo';

const SHEET = { members: 'members', events: 'events', matches: 'matches' };

const HEADERS = {
  members: ['member_id', 'team', 'name', 'display_name', 'active'],
  events: ['event_id', 'date', 'title', 'venue', 'note'],
  matches: ['match_id', 'event_id', 'date', 'h_p1', 'h_p2', 'm_p1', 'm_p2',
    'h_games', 'm_games', 'result', 'entered_at', 'entered_by', 'note', 'deleted'],
};

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

function doGet() {
  return jsonOut({ ok: true, app: 'tennis-hm', message: 'この API は POST で使います' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_request' });
  }

  const role = roleFor(body.key);
  if (!role) return jsonOut({ ok: false, error: 'auth' });

  try {
    switch (body.action) {
      case 'getAll':
        return jsonOut(getAll(role));
      case 'addMatch':
        if (role !== 'admin') return jsonOut({ ok: false, error: 'auth' });
        return jsonOut(addMatch(body.match || {}));
      default:
        return jsonOut({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------------------------------------------------------------------------
// 認証：パスワードから役割を決める（実値はスクリプトプロパティにだけ置く）
// ---------------------------------------------------------------------------

function roleFor(key) {
  if (key === undefined || key === null || key === '') return null;
  const props = PropertiesService.getScriptProperties();
  const admin = props.getProperty('ADMIN_PASS');
  const viewer = props.getProperty('VIEWER_PASS');
  const k = String(key).trim();
  if (admin && k === admin) return 'admin';
  if (viewer && k === viewer) return 'viewer';
  return null;
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

function getAll(role) {
  const members = readSheet(SHEET.members)
    .map(r => ({
      member_id: str(r.member_id),
      team: str(r.team).toUpperCase(),
      name: str(r.name),
      display_name: str(r.display_name) || str(r.name),
      active: toBool(r.active, true),
    }))
    .filter(m => m.member_id);

  const events = readSheet(SHEET.events)
    .map(r => ({
      event_id: str(r.event_id),
      date: dateStr(r.date),
      title: str(r.title),
      venue: str(r.venue),
      note: str(r.note),
    }))
    .filter(ev => ev.event_id)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const matches = readSheet(SHEET.matches)
    .filter(r => str(r.match_id) !== '' && !toBool(r.deleted, false))
    .map(r => {
      const h = Number(r.h_games);
      const m = Number(r.m_games);
      return {
        match_id: Number(r.match_id),
        event_id: str(r.event_id),
        date: dateStr(r.date),
        h_p1: str(r.h_p1),
        h_p2: str(r.h_p2),
        m_p1: str(r.m_p1),
        m_p2: str(r.m_p2),
        h_games: h,
        m_games: m,
        result: resultOf(h, m),
        entered_by: str(r.entered_by),
        note: str(r.note),
      };
    })
    // スコアがルール外の行（手入力ミスなど）は集計から外す。checkMatches() で見つけられる
    .filter(m => m.result !== '');

  return { ok: true, role: role, members: members, events: events, matches: matches };
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

function addMatch(input) {
  const eventId = str(input.event_id);
  const h = Number(input.h_games);
  const m = Number(input.m_games);

  const ev = readSheet(SHEET.events).find(r => str(r.event_id) === eventId);
  if (!ev) throw new Error('開催回が見つかりません: ' + eventId);

  if (!isValidScore(h, m)) throw new Error('スコアが不正です: ' + input.h_games + '-' + input.m_games);

  // 複数コートから同時に送られても連番が壊れないよう直列化する
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 検証がすべて通ってから members に書く。不正な送信で人が増えないようにする
    const members = readSheet(SHEET.members);
    const picks = [['h_p1', 'H'], ['h_p2', 'H'], ['m_p1', 'M'], ['m_p2', 'M']]
      .map(([k, team]) => pickMember(members, team, str(input[k])));
    if (samePerson(picks[0], picks[1]) || samePerson(picks[2], picks[3])) {
      throw new Error('同じ人がペアになっています');
    }
    const created = [];
    const ids = picks.map(p => {
      if (p.id) return p.id;
      const mb = addMember(members, p.team, p.name);
      created.push(mb);
      return mb.member_id;
    });

    const sheet = getSheet(SHEET.matches);
    const matchId = nextMatchId(sheet);
    const row = {
      match_id: matchId,
      event_id: eventId,
      date: dateStr(input.date) || dateStr(ev.date),
      h_p1: ids[0], h_p2: ids[1], m_p1: ids[2], m_p2: ids[3],
      h_games: h, m_games: m,
      result: resultOf(h, m),
      entered_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
      entered_by: str(input.entered_by),
      note: str(input.note),
      deleted: '',
    };
    sheet.appendRow(HEADERS.matches.map(k => row[k]));
    return { ok: true, match_id: matchId, ids: ids, created: created };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ID か名前から人を決める。登録済みなら { id }、初めての名前なら { team, name, key } を返す。
 * チームごとに探すので、H と M に同じ名前の人がいても別人として扱う。
 */
function pickMember(rows, team, value) {
  if (!value) throw new Error('名前が入力されていません');

  if (/^[HM]\d+$/i.test(value)) {
    const id = value.toUpperCase();
    const byId = rows.filter(r => str(r.member_id) === id)[0];
    if (!byId) throw new Error('メンバーが見つかりません: ' + value);
    if (str(byId.team).toUpperCase() !== team) {
      throw new Error(team + ' 側に ' + team + ' チーム以外の人がいます: ' + value);
    }
    return { id: id };
  }

  const key = nameKey(value);
  const inTeam = rows.filter(r => str(r.team).toUpperCase() === team);
  const shown = inTeam.filter(r => nameKey(str(r.display_name) || str(r.name)) === key);
  if (shown.length === 1) return { id: str(shown[0].member_id) };
  const named = inTeam.filter(r => nameKey(r.name) === key);
  if (named.length === 1) return { id: str(named[0].member_id) };
  if (shown.length || named.length) throw new Error('同じ名前の人が複数います: ' + value);

  // 先頭の = などはシートが数式として解釈するので受け付けない
  if (/^[=+\-@']/.test(value) || value.length > 20) throw new Error('使えない名前です: ' + value);
  return { team: team, name: value, key: key };
}

function samePerson(a, b) {
  return (a.id || a.key) === (b.id || b.key);
}

/** members に 1 行足す。rows も更新するので、同じ送信内の次の人の採番がずれない */
function addMember(rows, team, name) {
  const nums = rows
    .filter(r => str(r.team).toUpperCase() === team)
    .map(r => parseInt(str(r.member_id).slice(1), 10) || 0);
  const n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  const id = team + ('0' + n).slice(-2);
  const row = { member_id: id, team: team, name: name, display_name: name, active: true };
  getSheet(SHEET.members).appendRow(HEADERS.members.map(k => row[k]));
  rows.push(row);
  return row;
}

function nextMatchId(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues()
    .map(r => Number(r[0]))
    .filter(n => !isNaN(n) && n > 0);
  return (ids.length ? Math.max.apply(null, ids) : 0) + 1;
}

// ---------------------------------------------------------------------------
// 初期セットアップ・保守用（Apps Script エディタから手動で実行する）
// ---------------------------------------------------------------------------

/** シート 3 枚と見出しを作る。members は試合入力のときに自動で増える。何度実行しても壊れない */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEET).forEach(key => {
    const name = SHEET[key];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = HEADERS[key];
    const headRange = sheet.getRange(1, 1, 1, headers.length);
    if (headRange.getValues()[0].join('') === '') headRange.setValues([headers]);
    headRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  // 日付列は文字列として扱う（Sheets が勝手に日付型へ変えるとタイムゾーンでずれるため）
  ss.getSheetByName(SHEET.events).getRange('B:B').setNumberFormat('@');
  const mt = ss.getSheetByName(SHEET.matches);
  mt.getRange('C:C').setNumberFormat('@');
  mt.getRange('K:K').setNumberFormat('@');

  Logger.log('setup 完了: members / events / matches を用意しました');
}

/** matches の result 列を h_games / m_games から埋め直す（過去分を手入力したあとに実行） */
function recomputeResults() {
  const sheet = getSheet(SHEET.matches);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(v => str(v));
  const cH = headers.indexOf('h_games');
  const cM = headers.indexOf('m_games');
  const cR = headers.indexOf('result');
  if (cH < 0 || cM < 0 || cR < 0) throw new Error('見出しが見つかりません（setup() を実行してください）');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = resultOf(Number(values[i][cH]), Number(values[i][cM]));
    out.push([r]);
  }
  sheet.getRange(2, cR + 1, out.length, 1).setValues(out);
  Logger.log('result 列を ' + out.length + ' 行更新しました');
}

/** matches の問題行（不正スコア・未知のメンバー・チーム違い・未知の開催回）をログに出す */
function checkMatches() {
  const members = {};
  readSheet(SHEET.members).forEach(r => { members[str(r.member_id)] = str(r.team).toUpperCase(); });
  const events = {};
  readSheet(SHEET.events).forEach(r => { events[str(r.event_id)] = true; });

  const problems = [];
  readSheet(SHEET.matches).forEach((r, i) => {
    const line = 'row ' + (i + 2) + ' (match_id=' + str(r.match_id) + '): ';
    if (str(r.match_id) === '') problems.push(line + 'match_id が空');
    if (!events[str(r.event_id)]) problems.push(line + '開催回が events にない: ' + str(r.event_id));
    [['h_p1', 'H'], ['h_p2', 'H'], ['m_p1', 'M'], ['m_p2', 'M']].forEach(([col, team]) => {
      const id = str(r[col]);
      if (!members[id]) problems.push(line + col + ' が members にない: ' + id);
      else if (members[id] !== team) problems.push(line + col + ' が ' + team + ' チームではない: ' + id);
    });
    if (str(r.h_p1) === str(r.h_p2) || str(r.m_p1) === str(r.m_p2)) problems.push(line + '同じ人がペア');
    if (!isValidScore(Number(r.h_games), Number(r.m_games))) {
      problems.push(line + 'スコアがルール外: ' + str(r.h_games) + '-' + str(r.m_games));
    }
  });

  Logger.log(problems.length ? problems.join('\n') : '問題は見つかりませんでした');
}

/** エディタ上で getAll の結果を確認する */
function testGetAll() {
  Logger.log(JSON.stringify(getAll('admin')).slice(0, 3000));
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function readSheet(name) {
  const values = getSheet(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => str(h));
  return values.slice(1)
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
      return obj;
    });
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('シートがありません: ' + name + '（setup() を実行してください）');
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/** 名前の比較用キー。全角半角・空白・大文字小文字の違いを無視する */
function nameKey(v) {
  return str(v).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function toBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

/** Date 型でも '2026/5/17' でも 'YYYY-MM-DD' に揃える */
function dateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = str(v);
  const mt = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!mt) return s;
  return mt[1] + '-' + ('0' + mt[2]).slice(-2) + '-' + ('0' + mt[3]).slice(-2);
}

/** 6 ゲーム先取・5-5 引き分けのルールで取りうるスコアか */
function isValidScore(h, m) {
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  if (h === 6 && m >= 0 && m <= 4) return true;
  if (m === 6 && h >= 0 && h <= 4) return true;
  return h === 5 && m === 5;
}

function resultOf(h, m) {
  if (!isValidScore(h, m)) return '';
  if (h === 6) return 'H';
  if (m === 6) return 'M';
  return 'D';
}

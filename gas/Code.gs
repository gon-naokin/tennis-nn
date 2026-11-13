/**
 * テニス班 戦績アプリ — Google Apps Script（API 本体）
 *
 * セットアップ手順は README.md を参照。
 *   1. スプレッドシートの「拡張機能 → Apps Script」を開き、このファイルの内容を貼り付けて保存
 *   2. エディタ上で setup() を実行（初回は権限の承認が出る）。旧版（H vs M）のシートもここで新しい形に移行する
 *   3. プロジェクトの設定 → スクリプト プロパティ に VIEWER_PASS / ADMIN_PASS を登録
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」／実行ユーザー「自分」／アクセス「全員」
 *   5. 発行された URL を docs/js/config.js の GAS_URL に貼る
 *
 * API（すべて POST、本文は JSON 文字列）
 *   { action: 'getAll',   key }         → { ok, role, members, events, matches }
 *   { action: 'addMatch', key, match }  → { ok, match_id, ids, created }   ※ key は ADMIN_PASS のみ
 *     match = { type: 'S' | 'D', date: 'YYYY-MM-DD', a1, a2, b1, b2, a_games, b_games, entered_by, note }
 *     a1〜b2 は member_id か名前。シングルスでは a2 / b2 を空にする。
 *     初めての名前は members に追加し、created で返す。ids は [a1, a2, b1, b2] の member_id。
 *   失敗時は { ok: false, error: '...' }。error が 'auth' ならパスワード不一致。
 */

const TZ = 'Asia/Tokyo';

const SHEET = { members: 'members', events: 'events', matches: 'matches' };

// 新しく作るシートの見出し。既存シートは列の並びが違っても見出し名で読み書きする
const HEADERS = {
  members: ['member_id', 'name', 'display_name', 'active'],
  events: ['event_id', 'date', 'title', 'venue', 'note'],
  matches: ['match_id', 'date', 'type', 'a1', 'a2', 'b1', 'b2',
    'a_games', 'b_games', 'result', 'entered_at', 'entered_by', 'note', 'deleted', 'event_id'],
};

// 旧版（H vs M 交流戦）の matches 見出し → 新しい見出し。H 側を A 側、M 側を B 側として引き継ぐ
const RENAMED = { h_p1: 'a1', h_p2: 'a2', m_p1: 'b1', m_p2: 'b2', h_games: 'a_games', m_games: 'b_games' };

// 新しく登録する人の member_id の頭文字（P01, P02 …）
const NEW_ID_PREFIX = 'P';

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

function doGet() {
  return jsonOut({ ok: true, app: 'tennis-club', message: 'この API は POST で使います' });
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
    .filter(ev => ev.event_id);

  const matches = readSheet(SHEET.matches)
    .filter(r => str(r.match_id) !== '' && !toBool(r.deleted, false))
    .map(r => {
      const m = normalizeRow(r);
      const a = Number(m.a_games);
      const b = Number(m.b_games);
      const type = typeOf(m.type);
      return {
        match_id: Number(m.match_id),
        date: dateStr(m.date),
        type: type,
        a1: str(m.a1),
        a2: type === 'D' ? str(m.a2) : '',
        b1: str(m.b1),
        b2: type === 'D' ? str(m.b2) : '',
        a_games: a,
        b_games: b,
        result: resultOf(a, b),
        entered_by: str(m.entered_by),
        note: str(m.note),
        event_id: str(m.event_id),
      };
    })
    // スコアがルール外の行（手入力ミスなど）は集計から外す。checkMatches() で見つけられる
    .filter(m => m.result !== '' && m.a1 && m.b1);

  return { ok: true, role: role, members: members, events: events, matches: matches };
}

/** 旧見出しのままのシートでも読めるようにする（setup() 前でも動く） */
function normalizeRow(r) {
  const out = {};
  Object.keys(r).forEach(k => { out[RENAMED[k] || k] = r[k]; });
  return out;
}

/** 種目。空欄は旧版のデータなのでダブルス扱い */
function typeOf(v) {
  return str(v).toUpperCase() === 'S' ? 'S' : 'D';
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

function addMatch(input) {
  const t = str(input.type).toUpperCase();
  if (t !== 'S' && t !== 'D') throw new Error('種目が不正です: ' + str(input.type));
  const a = Number(input.a_games);
  const b = Number(input.b_games);
  if (!isValidScore(a, b)) throw new Error('スコアが不正です: ' + input.a_games + '-' + input.b_games);
  const date = str(input.date) ? dateStr(input.date) : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付が不正です: ' + str(input.date));
  const keys = t === 'S' ? ['a1', 'b1'] : ['a1', 'a2', 'b1', 'b2'];

  // 複数コートから同時に送られても連番が壊れないよう直列化する
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet(SHEET.matches);
    if (headersOf(sheet).indexOf('type') < 0) {
      throw new Error('matches に type 列がありません（Apps Script で setup() を実行してください）');
    }
    // 検証がすべて通ってから members に書く。不正な送信で人が増えないようにする
    const members = readSheet(SHEET.members);
    const picks = keys.map(k => pickMember(members, str(input[k])));
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        if (samePerson(picks[i], picks[j])) throw new Error('同じ人が 2 回入っています');
      }
    }
    const created = [];
    const ids = {};
    picks.forEach((p, i) => {
      if (p.id) { ids[keys[i]] = p.id; return; }
      const mb = addMember(members, p.name);
      created.push(mb);
      ids[keys[i]] = mb.member_id;
    });

    const matchId = nextMatchId(sheet);
    appendObject(sheet, {
      match_id: matchId,
      date: date,
      type: t,
      a1: ids.a1, a2: ids.a2 || '', b1: ids.b1, b2: ids.b2 || '',
      a_games: a, b_games: b,
      result: resultOf(a, b),
      entered_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
      entered_by: str(input.entered_by),
      note: str(input.note),
      deleted: '',
      event_id: str(input.event_id),
    });
    return { ok: true, match_id: matchId, ids: [ids.a1, ids.a2 || '', ids.b1, ids.b2 || ''], created: created };
  } finally {
    lock.releaseLock();
  }
}

/** ID か名前から人を決める。登録済みなら { id }、初めての名前なら { name, key } を返す */
function pickMember(rows, value) {
  if (!value) throw new Error('名前が入力されていません');

  // H01・M02（旧版）や P01 のような ID はそのまま使う
  if (/^[A-Z]\d+$/i.test(value)) {
    const id = value.toUpperCase();
    const byId = rows.filter(r => str(r.member_id).toUpperCase() === id)[0];
    if (!byId) throw new Error('メンバーが見つかりません: ' + value);
    return { id: str(byId.member_id) };
  }

  const key = nameKey(value);
  const shown = rows.filter(r => nameKey(str(r.display_name) || str(r.name)) === key);
  if (shown.length === 1) return { id: str(shown[0].member_id) };
  const named = rows.filter(r => nameKey(r.name) === key);
  if (named.length === 1) return { id: str(named[0].member_id) };
  if (shown.length || named.length) {
    throw new Error('同じ名前の人が複数います: ' + value + '（members の display_name を区別してください）');
  }

  // 先頭の = などはシートが数式として解釈するので受け付けない
  if (/^[=+\-@']/.test(value) || value.length > 20) throw new Error('使えない名前です: ' + value);
  return { name: value, key: key };
}

function samePerson(a, b) {
  return (a.id || a.key) === (b.id || b.key);
}

/** members に 1 行足す。rows も更新するので、同じ送信内の次の人の採番がずれない */
function addMember(rows, name) {
  const re = new RegExp('^' + NEW_ID_PREFIX + '(\\d+)$', 'i');
  const nums = rows.map(r => {
    const mt = str(r.member_id).match(re);
    return mt ? Number(mt[1]) : 0;
  });
  const n = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  const id = NEW_ID_PREFIX + ('0' + n).slice(-2);
  const row = { member_id: id, name: name, display_name: name, active: true };
  appendObject(getSheet(SHEET.members), row);
  rows.push(row);
  return row;
}

function nextMatchId(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const col = headersOf(sheet).indexOf('match_id') + 1 || 1;
  const ids = sheet.getRange(2, col, last - 1, 1).getValues()
    .map(r => Number(r[0]))
    .filter(n => !isNaN(n) && n > 0);
  return (ids.length ? Math.max.apply(null, ids) : 0) + 1;
}

// ---------------------------------------------------------------------------
// 初期セットアップ・保守用（Apps Script エディタから手動で実行する）
// ---------------------------------------------------------------------------

/**
 * シート 3 枚と見出しを用意する。旧版のシートは新しい見出しに移行する。何度実行しても壊れない。
 * 移行内容：h_p1 → a1 などの見出し名の変更、type 列の追加（既存の試合はダブルス = D）、result の再計算
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEET).forEach(key => {
    const name = SHEET[key];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = HEADERS[key];
    if (sheet.getLastColumn() === 0 || headersOf(sheet).join('') === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    if (key === 'matches') migrateMatches(sheet);
    addMissingColumns(sheet, headers);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  // 日付列は文字列として扱う（Sheets が勝手に日付型へ変えるとタイムゾーンでずれるため）
  textColumn(ss.getSheetByName(SHEET.events), 'date');
  textColumn(ss.getSheetByName(SHEET.matches), 'date');
  textColumn(ss.getSheetByName(SHEET.matches), 'entered_at');

  recomputeResults();
  Logger.log('setup 完了: members / events / matches を用意しました');
}

/** 旧版の見出しを新しい名前に変え、type 列を足して既存の試合をダブルスにする */
function migrateMatches(sheet) {
  const lastCol = sheet.getLastColumn();
  const heads = headersOf(sheet);
  const renamed = heads.map(h => RENAMED[h] || h);
  if (renamed.join('|') !== heads.join('|')) {
    sheet.getRange(1, 1, 1, lastCol).setValues([renamed]);
    Logger.log('matches の見出しを新しい形に変えました');
  }
  if (renamed.indexOf('type') < 0) {
    sheet.getRange(1, lastCol + 1).setValue('type');
    const rows = sheet.getLastRow() - 1;
    if (rows > 0) sheet.getRange(2, lastCol + 1, rows, 1).setValue('D');
    Logger.log('type 列を追加し、既存の ' + Math.max(rows, 0) + ' 試合をダブルスにしました');
  }
}

/** 見出しに無い列を右端に足す */
function addMissingColumns(sheet, headers) {
  const heads = headersOf(sheet);
  const missing = headers.filter(h => heads.indexOf(h) < 0);
  if (missing.length) sheet.getRange(1, heads.length + 1, 1, missing.length).setValues([missing]);
}

function textColumn(sheet, name) {
  const col = headersOf(sheet).indexOf(name) + 1;
  if (col > 0) sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
}

/** matches の result 列を a_games / b_games から埋め直す（過去分を手入力したあとに実行） */
function recomputeResults() {
  const sheet = getSheet(SHEET.matches);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(v => RENAMED[str(v)] || str(v));
  const cA = headers.indexOf('a_games');
  const cB = headers.indexOf('b_games');
  const cR = headers.indexOf('result');
  if (cA < 0 || cB < 0 || cR < 0) throw new Error('見出しが見つかりません（setup() を実行してください）');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    out.push([resultOf(Number(values[i][cA]), Number(values[i][cB]))]);
  }
  sheet.getRange(2, cR + 1, out.length, 1).setValues(out);
  Logger.log('result 列を ' + out.length + ' 行更新しました');
}

/** matches の問題行（不正スコア・種目・未知のメンバー・同じ人の重複）をログに出す */
function checkMatches() {
  const members = {};
  readSheet(SHEET.members).forEach(r => { members[str(r.member_id)] = true; });

  const problems = [];
  readSheet(SHEET.matches).forEach((raw, i) => {
    const r = normalizeRow(raw);
    const line = 'row ' + (i + 2) + ' (match_id=' + str(r.match_id) + '): ';
    if (str(r.match_id) === '') problems.push(line + 'match_id が空');
    const t = str(r.type).toUpperCase();
    if (t && t !== 'S' && t !== 'D') problems.push(line + 'type は S か D: ' + str(r.type));
    const cols = typeOf(r.type) === 'S' ? ['a1', 'b1'] : ['a1', 'a2', 'b1', 'b2'];
    const ids = cols.map(c => str(r[c]));
    cols.forEach((c, k) => {
      if (!ids[k]) problems.push(line + c + ' が空');
      else if (!members[ids[k]]) problems.push(line + c + ' が members にない: ' + ids[k]);
    });
    if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) problems.push(line + '同じ人が 2 回入っている');
    if (!isValidScore(Number(r.a_games), Number(r.b_games))) {
      problems.push(line + 'スコアがルール外: ' + str(r.a_games) + '-' + str(r.b_games));
    }
    if (str(r.date) && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr(r.date))) problems.push(line + '日付の形が不正: ' + str(r.date));
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

function headersOf(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => str(h));
}

/** シートの見出しの並びに合わせて 1 行足す。見出しに無い項目は書かない */
function appendObject(sheet, obj) {
  const heads = headersOf(sheet).map(h => RENAMED[h] || h);
  sheet.appendRow(heads.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h])));
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
function isValidScore(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if (a === 6 && b >= 0 && b <= 4) return true;
  if (b === 6 && a >= 0 && a <= 4) return true;
  return a === 5 && b === 5;
}

/** A 側の勝ち = 'A'、B 側の勝ち = 'B'、引き分け = 'D' */
function resultOf(a, b) {
  if (!isValidScore(a, b)) return '';
  if (a === 6) return 'A';
  if (b === 6) return 'B';
  return 'D';
}

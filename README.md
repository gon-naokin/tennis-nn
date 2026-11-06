# H vs M テニス交流戦 戦績アプリ

H チームと M チームのダブルス交流戦の結果を入力し、チーム戦績と個人成績を見るための Web アプリです。
設計の全体像は [DESIGN.md](DESIGN.md) を参照してください。

| 層 | 使うもの | 置き場所 |
|---|---|---|
| 画面 | GitHub Pages（静的 HTML/JS） | `docs/` |
| API | Google Apps Script（GAS）ウェブアプリ | `gas/Code.gs` を Apps Script に貼る |
| データ | Google スプレッドシート | 自分の Google ドライブ |

```
tennis-hm/
├── docs/              GitHub Pages で公開するフォルダ
│   ├── index.html     戦績ダッシュボード
│   ├── players.html   個人成績（対戦相手別・パートナー別）
│   ├── matches.html   試合一覧
│   ├── input.html     試合結果入力（幹事のみ）
│   ├── css/style.css
│   ├── img/           キャラクター画像（白フチ付きの透過 PNG）とアプリアイコン
│   └── js/
│       ├── config.js  GAS の URL（ここだけ環境依存）
│       ├── auth.js    入り口パスワード
│       ├── api.js     GAS との通信
│       ├── stats.js   集計ロジック
│       ├── ui.js      画面共通の小道具
│       └── mock.js    サンプルデータ（GAS 未設定のときだけ使う）
├── gas/Code.gs        Apps Script 本体
├── SECRETS.local.md   パスワードの実値（git に入れない）
├── DESIGN.md          設計書
└── README.md          このファイル
```

---

## セットアップ（初回だけ）

### 1. スプレッドシートと Apps Script

1. Google ドライブで新しいスプレッドシートを作る（名前は「H vs M 交流戦」など）。
2. メニューの **拡張機能 → Apps Script** を開く。
3. 最初から入っている `コード.gs` の中身をすべて消し、`gas/Code.gs` の内容を貼り付けて保存する。
4. エディタ上部の関数選択で **`setup`** を選び **実行** する。
   初回は権限の承認を求められる。「このアプリは Google で確認されていません」と出たら **詳細 → （安全ではないページ）に移動 → 許可** と進む。
5. スプレッドシートに `members` / `events` / `matches` の 3 シートが作られ、`members` に 25 行（H01〜H11、M01〜M14）がダミー名で入る。
   `name` と `display_name` を実名に書き換える（実名一覧は `SECRETS.local.md`）。同じ姓の人は `display_name` を「山田(H)」「山田(M)」のように区別する。
6. `events` シートに開催回を追加する。例：

   | event_id | date | title | venue | note |
   |---|---|---|---|---|
   | E001 | 2026-05-17 | 第1回交流戦 | | |
   | E002 | 2026-09-06 | 第2回交流戦 | | |

   `date` は `YYYY-MM-DD` で入れる（列は文字列扱いに設定済み）。

### 2. パスワードを登録する

1. Apps Script エディタ左の **プロジェクトの設定**（歯車）を開く。
2. 下の **スクリプト プロパティ → スクリプト プロパティを追加** で次の 2 つを登録する。

   | プロパティ | 用途 |
   |---|---|
   | `VIEWER_PASS` | 閲覧用パスワード |
   | `ADMIN_PASS` | 幹事用パスワード（入力もできる） |

   値は `SECRETS.local.md` にある。前後に空白を入れないこと。

### 3. ウェブアプリとしてデプロイする

1. エディタ右上の **デプロイ → 新しいデプロイ**。
2. 左上の歯車で種類を **ウェブアプリ** にする。
3. 設定：
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**
4. **デプロイ** を押し、表示される **ウェブアプリの URL**（`https://script.google.com/macros/s/…/exec`）をコピーする。

### 4. サイトに URL を設定する

`docs/js/config.js` の `GAS_URL` にコピーした URL を貼る。

```js
GAS_URL: 'https://script.google.com/macros/s/XXXX/exec',
```

### 5. ローカルで動作確認する

`docs` フォルダを簡易サーバーで開く。

```bash
python -m http.server 8787 --directory docs
```

ブラウザで `http://localhost:8787/` を開き、パスワードを入れて戦績が表示されれば OK。
幹事用パスワードで入ると「入力」が現れるので、1 試合入れてスプレッドシートの `matches` に行が増えることを確認する。

### 6. GitHub Pages で公開する

1. GitHub で新しいリポジトリを作る（無料プランで Pages を使うなら Public）。
2. `tennis-hm` フォルダの中身を push する（`SECRETS.local.md` は `.gitignore` で除外済み）。
3. リポジトリの **Settings → Pages** で
   - Source: **Deploy from a branch**
   - Branch: **main**、Folder: **/docs**
   として Save。
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける。スマホのホーム画面に追加しておくと便利。

---

## 過去の交流戦の結果を入れる

`matches` シートに直接行を追加する。

| 列 | 入れる値 |
|---|---|
| match_id | 連番（1, 2, 3 …）。重複しないこと |
| event_id | `events` の event_id |
| date | `YYYY-MM-DD`（開催日） |
| h_p1, h_p2 | H 側 2 人の member_id（H01 など） |
| m_p1, m_p2 | M 側 2 人の member_id（M01 など） |
| h_games, m_games | ゲーム数。6-0〜6-4、0-6〜4-6、5-5 のどれか |
| result | 空でよい（`recomputeResults()` で埋まる。API はゲーム数から計算する） |
| entered_at | 空でよい |
| entered_by | 「過去分」など任意 |
| note, deleted | 空 |

入れ終わったら Apps Script エディタで **`checkMatches`** を実行し、ログに「問題は見つかりませんでした」と出ることを確認する。
見た目を揃えたければ **`recomputeResults`** も実行する。

---

## 日々の運用

| やること | 方法 |
|---|---|
| 試合結果の入力 | 幹事が幹事用パスワードで入り、「入力」から送る |
| 誤入力の取り消し | `matches` の該当行の `deleted` 列に `TRUE` を入れる |
| スコアの修正 | `matches` の `h_games` / `m_games` を直す（`result` も直すか `recomputeResults` を実行） |
| メンバー追加 | `members` に行を追加。退会は `active` を `FALSE` に |
| 開催回の追加 | `events` に行を追加 |
| パスワード変更 | スクリプト プロパティの値を変える。サイトの再デプロイは不要。閲覧者は入れ直しになる |
| `Code.gs` を更新したとき | **デプロイ → デプロイを管理 → 鉛筆 → バージョン：新バージョン → デプロイ**。URL は変わらない |

画面は 1 分間データをキャッシュするので、シートを直してすぐ反映されないときは再読み込みするか、ログアウトして入り直す。

---

## サンプルモード

`config.js` の `GAS_URL` が空のときは `mock.js` のサンプルデータで動く（画面上部に黄色い帯が出る）。
パスワードは何でも通り、`admin` と入れると幹事扱いになる。入力した試合はそのタブを閉じると消える。
GAS を用意する前に画面を確認したいときに使う。

---

## うまくいかないとき

| 症状 | 確認すること |
|---|---|
| 「サーバーの応答を読めませんでした」 | `GAS_URL` が `/exec` で終わっているか。デプロイのアクセスが「全員」になっているか |
| 合っているはずなのに「パスワードが違います」 | スクリプト プロパティ名の綴り（`VIEWER_PASS` / `ADMIN_PASS`）と、値の前後の空白 |
| 入力したのに戦績に出ない | 1 分キャッシュ。再読み込みする。`matches` に行が増えているかも見る |
| `Code.gs` を直したのに変わらない | 「新しいデプロイ」ではなく既存デプロイを「新バージョン」で更新したか |
| 特定の試合だけ集計から消えている | スコアがルール外の可能性。`checkMatches` を実行する |

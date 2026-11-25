> **未解決のため実行できません。** この例は未決の検証Skillに属します。ユーザーへ未解決と伝えて停止してください。コマンド・ラベルは原文のまま保持します。

# ノートを検索する

検索では題名か本文の文字列からノートを探し、一致したノートを開き、一致なしと検索が利用できない状態を区別できる。

## Sub-features

- `search-open`：各ブラウザー入口から検索を開く。
- `search-match`：ノートを変更せず、題名と本文の一致を返す。
- `search-open-result`：検索結果をノート編集画面で開く。
- `search-empty`：一致しないクエリに対する完全な空の状態を表示する。
- `search-clear`：クエリを消し、最近のノート一覧を復元する。
- `search-cli`：端末でも同じ一致ノートを返す。

## How to get to it (user POV)

- ブラウザーツールバーの`Search`を選ぶ。
- 編集可能な欄以外にフォーカスがあるとき、ブラウザーで`/`を押す。
- 端末で`notes search <query>`を実行する。

## Driving it with control-notes

Preconditions:

- Notesが`http://127.0.0.1:4173`で正常に動作している。
- 破棄可能なデータディレクトリに、本文`Draft budget`の`Quarterly plan`というノートがある。
- `control-notes doctor`が期待するURLとデータディレクトリを報告する。

- **ツールバーから開く。** `Search`を選ぶ。`control-notes browser click --role button --name "Search"`を実行する。`Search notes`というダイアログが表示され、検索ボックスへフォーカスが移る。
- **キーボードから開く。** ダイアログを閉じ、ページにフォーカスして`/`を押す。`control-notes browser press --key "/"`を実行する。同じダイアログが表示され、ページ本文にはスラッシュが入力されない。
- **題名で一致させる。** `quarterly`を入力する。`control-notes browser fill --role searchbox --name "Search notes" --value "quarterly"`を実行する。`Search results`には`Quarterly plan`が含まれ、`Grocery list`は含まれない。
- **本文で一致させる。** クエリを`budget`に変更する。`control-notes browser fill --role searchbox --name "Search notes" --value "budget"`を実行する。本文一致の抜粋とともに`Quarterly plan`が表示される。
- **結果を開く。** `Quarterly plan`を選ぶ。`control-notes browser click --role link --name "Quarterly plan"`を実行する。ダイアログが閉じ、編集画面の見出しは`Quarterly plan`になる。
- **一致なしを表示する。** 検索を開き直して`volcano`と入力する。`control-notes browser fill --role searchbox --name "Search notes" --value "volcano"`を実行する。検索完了後に`No matching notes`という状態が表示される。
- **検索を解除する。** `Clear search`を選ぶ。`control-notes browser click --role button --name "Clear search"`を実行する。検索ボックスが空になり、結果一覧に代わり`Recent notes`領域が表示される。
- **CLIで一致を確認する。** 端末から検索する。`control-notes cli -- notes search "quarterly" --format json`を実行する。終了コード`0`、stdoutには題名が`Quarterly plan`のオブジェクト1つが含まれる。
- **CLIで不一致を確認する。** 存在しない値を検索する。`control-notes cli -- notes search "volcano" --format json`を実行する。終了コード`0`、stdoutは`[]`となる。
- **証拠を残す。** 結果がある状態を取得する。`control-notes browser snapshot --aria --path artifacts/search/results.aria.txt`と`control-notes browser screenshot --path artifacts/search/results.png`を実行する。両方の成果物にNotesの名称、クエリ、`Quarterly plan`が含まれる。

## Gotchas

- 編集画面または検索ボックスにフォーカスがあるときの`/`は、検索を開かず入力欄へ文字を挿入する。
- 結果は短いdebounceの後に更新される。固定のsleepではなく結果一覧か空の状態表示を待つ。
- ユーザーが`Include archived`を有効にしない限り、アーカイブされたノートは除外する。
- CLIの既定出力は人間向け。安定したアサーションには`--format json`を使う。
- 結果を開くとブラウザーの状態が変わる。別のクエリを確認する前に検索を開き直す。

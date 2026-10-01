## 日本語 textlint

まとまった変更の校正を依頼されたときに、日本語のコメント、JSDoc、Markdown、テキスト文書を確認する。
通常の実装作業では、この手順の実行を必須にしない。

以下のコマンドは対象リポジトリのルートで実行する。変更ファイルの静的検査には次を使用する。

    pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../..

検査対象をファイルやフォルダに限定できる。

    pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../.. .agents/docs/Testing-Policy.md
    pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../.. apps/vscode-nerita/src/extension packages/shared/src

リポジトリ全体を確認する場合のみ次を使用する。

    pnpm --dir .agents/skills/japanese-proofreading textlint --root ../../..

`textlint` と `textlint:changed` のどちらも、引数を複数指定できる。
`textlint:changed` にファイルやフォルダを明示した場合は、Git の変更状態に関係なく指定対象を検査する。
`.textlintignore` に含まれるファイルやディレクトリは対象外とする。
リポジトリ外のパスとシンボリックリンクは検査対象として受け付けない。

### textlint の修正方針

textlint が英語・識別子と日本語の不自然な接続を報告した場合、
単純な文字置換ではなく、周囲のコードと文章を確認して修正する。

コード上の識別子、型名、関数名、API 名、コマンド名、
製品名、ライブラリ名、プロトコル名などは、
実際の名称である場合は翻訳しない。

一般的な日本語訳が定着している自然言語上の技術用語は、
自然な日本語へ置き換える。

<!-- texlint-ignore-start -->
例を示す。

    canonical化
    → 正規化

    retryする
    → 再試行する

    disposeする
    → 破棄する

    Tool名
    → ツール名

識別子の場合は次のように表記する。

    Controllerが
    → `Controller` が

    signalは
    → `signal` は

    pwshが
    → `pwsh` が
<!-- texlint-ignore-end-->

textlint の警告を機械的に修正しない。
コード上の意味を確認してから修正する。

### 静的な英単語チェック

日本語文章に裸で混在する英単語も、通常の textlint 実行時に確認する。
設定はスキル内の `config/textlint-terms.json` に置く。

- `preferredJapanese`: 一般的な日本語表現へ置き換えたい語と推奨表記。最優先で判定する。
- `technicalDictionary`: SHA を固定した CSpell の技術辞書ソース。一般英語辞書は使わない。
- `allowedEnglish`: 辞書やプロジェクト情報でも判断できない固有名詞などの例外。

CSpell の技術辞書は初回だけ取得し、`.textlint-cache/technical-terms.json` に圧縮して保存する。
取得元のリビジョンを固定するため、上流更新だけで lint 結果は変わらない。
ネットワークから取得できない場合は警告を表示し、外部辞書なしでレビュー候補を出す。

`package.json` の依存パッケージ、実行コマンド、スクリプト中のパスもプロジェクト語彙として自動許可する。
CSpell は software-terms 本体と Node 辞書も使用し、一般英語辞書は使用しない。
`CPU`、`ESM`、`CJS`、`WASM`、`SHA-256` のような大文字の技術略語も自動許可する。
`320px`、`32KiB`、`2 MiB` などの数値と単位、キーボードショートカット、I/O 表記、バージョン番号は英単語レビューの対象外とする。
`config.toml`、`guardrails.json`、`models-manager/models.json` のようなファイル名・パスも対象外とする。
`npm:`、`node_modules`、パッケージの manifest / metadata 名、scoped package、バージョン併記からパッケージ名を自動抽出し、同じ実行内では技術語として扱う。単なるハイフン語はパッケージと推測しない。
`ls`、`gh`、`chcp` などの既知コマンド名、`Backspace`、`Tab`、`Undo` などのキー名、`/plan` のようなスラッシュコマンドはレビュー対象外とする。
TypeScript / JavaScript の構文木に実在する識別子が裸で出た場合は、バッククォート不足のエラーとして扱う。
対象は `camelCase`、複合 `PascalCase`、`snake_case` 形式に限る。
単語1個の `Plan` や `Tool` のような PascalCase は自動識別子扱いしない。
`preferredJapanese` はこれらの自動語彙・識別子判定より優先するため、`owner` などを辞書やコードが認識しても日本語化のエラーを維持できる。

未登録の英単語はレビュー候補として表示するが、それだけではコマンドを失敗させない。
バッククォート内の識別子、URL、Markdown のリンク先、HTML コメントは英単語チェックから除外する。
文書の検査対象から外す範囲は、単独行の `<!-- texlint-ignore-start -->` と `<!-- texlint-ignore-end-->` で囲む。

候補がある場合だけ `.textlint-cache/issues-all.json` または
`.textlint-cache/issues-changed.json` を生成する。
`unknown-english` と `preferred-japanese` は先頭の大文字小文字を区別せず同じ語としてまとめ、表記差がある場合は `variants` に元表記を残す。`unquoted-identifier` は識別子名として大文字小文字を区別する。保存する出現例は最大20件に抑える。

### コメントの意味レビュー

静的検査の `textlint` / `textlint:changed` では、
全日本語文章のレビュー用ファイルを生成しない。

変更した文章を LLM で意味レビューする場合は次を使用する。
引数を明示した `textlint:review:changed` も、Git の変更状態に関係なく指定対象をレビューする。

    pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../..

ファイルやフォルダへ限定する場合は次のように指定する。

    pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../.. .agents/docs/Testing-Policy.md
    pnpm --dir .agents/skills/japanese-proofreading textlint:review --root ../../.. .agents/docs

リポジトリ全体を意味レビューする場合だけ次を使用する。

    pnpm --dir .agents/skills/japanese-proofreading textlint:review --root ../../..

レビュー用の全文は `.textlint-cache/review-changed.jsonl` または
`.textlint-cache/review-all.jsonl` に1項目1行で一時保存する。
巨大な整形済み JSON は作らない。

同じ範囲の textlint を次に実行すると、対応する古い候補ファイルと
レビュー用ファイルを先に削除する。
校正後に通常の textlint を再実行すれば、校正前のレビュー内容は残らない。

一時ファイルをまとめて削除する場合は次を使用する。

    pnpm --dir .agents/skills/japanese-proofreading textlint:clean --root ../../..

textlint で警告されなかった文章も含めて、
意味レビューでは変更した日本語コメントを周囲のコードと照合する。

次のような文章は修正する。

- 文法的には成立していても意味が不明瞭ではないか
- 実装に存在しない概念をコメント内で作っていないか
- 複数の処理を不自然な造語で圧縮していないか
- 対象・条件・処理・結果の関係が分かるか
- コードを読んだとき、コメントの説明と実装が一致しているか
- 英語を不自然に日本語化していないか
- 一般的な日本語表現へ置き換えられる技術語を雑に英語のまま使っていないか

コード上の実際の操作を具体的な日本語で記述する。

例を示す。

NG:

    roleを正規化して親上限と交差する。

OK:

    `role` を正規化し、親の `role` で許可された権限との共通部分だけを残す。

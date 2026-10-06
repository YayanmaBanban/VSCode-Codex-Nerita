<!-- textlint-disable ja-technical-writing/no-mix-dearu-desumasu -->

# 日本語校正スキル

コメント・JSDoc・文字列・JSX 本文・README・Markdown の日本語を、まとまった変更の後に校正するスキルです。
静的検査に加え、エージェントが周辺コードや文章を読み、説明と実装の一致や文章の読みやすさを確認します。
通常の実装や `pnpm package` では自動実行せず、校正を依頼したときに使います。

この README は利用者・保守者向けの案内です。エージェントの実行手順は `SKILL.md` にまとめています。

## セットアップ

Node.js 22.19.0 以降と pnpm が必要です。変更ファイルの自動抽出には、HEAD が存在する Git リポジトリも必要になります。

別のリポジトリへ導入する場合は、`node_modules/` を除いたスキル一式を `.agents/skills/japanese-proofreading/` にコピーします。
コピー先が pnpm ワークスペースの場合は、その `pnpm-workspace.yaml` の `packages` にスキルのディレクトリも登録してください。本リポジトリでは登録済みです。

スキルを配置したリポジトリのルートから次を実行してください。

```sh
pnpm --dir .agents/skills/japanese-proofreading install
```

`--dir` はコマンドの実行ディレクトリを指定します。ワークスペース内では、標準の設定でワークスペース全体の依存関係がインストール対象になります。
Windows で PowerShell の実行ポリシーにより起動できない場合は、`pnpm` を `pnpm.cmd` に置き換えてください。

外部の技術辞書は、保存済みの辞書が利用できない場合に取得します。取得できない場合は警告を表示し、外部辞書なしで検査を続けます。

## スキルとして使う

対象リポジトリを開いたエージェントに、範囲とともに校正を依頼してください。

```text
$japanese-proofreading で未コミットの変更分を校正してください。
```

```text
$japanese-proofreading で README.md を校正してください。
意味を保ちながら、AIっぽい表現と読みにくい段落を整理してください。
```

```text
$japanese-proofreading でリポジトリ全体の日本語を校正してください。
```

```text
$japanese-proofreading で<Notionのリンク>を校正してください。
```

スキル名で呼び出せない環境では、`.agents/skills/japanese-proofreading/SKILL.md` の手順で校正するよう依頼できます。
範囲を省略した場合は未コミット変更が対象です。コミット済みの変更を扱う場合は、比較元や対象ファイルを明示してください。

## コマンドで使う

以下はすべて対象リポジトリのルートから実行する例です。
コマンドの役割は、静的検査とレビュー用データの生成です。文章の意味の確認・修正には、エージェントによる校正が必要です。

対象ファイル・フォルダを指定しない場合、各コマンドは次の処理を実行します。

| コマンド名                | 処理                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `textlint:changed`        | HEAD との差分に含まれるファイルと未追跡ファイルを静的に検査 |
| `textlint:review:changed` | 同じ対象の静的検査とレビュー用データの生成                  |
| `textlint`                | リポジトリ全体を静的に検査                                  |
| `textlint:review`         | 全体の静的検査とレビュー用データの生成                      |
| `textlint:clean`          | 対象リポジトリの検査用キャッシュを削除                      |

変更分のレビュー用データを生成し、校正後に同じ対象を再検査する例です。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../..
# エージェントがレビュー用データと元ファイルを確認し、校正します。
pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../..
```

ファイルやフォルダを指定すると、Git の変更状態に関係なく指定範囲を検査します。
複数の対象を並べることもできます。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review --root ../../.. README.md packages/shared/src
# 校正後も同じ対象を指定してください。
pnpm --dir .agents/skills/japanese-proofreading textlint --root ../../.. README.md packages/shared/src
```

`--root` は必須です。パスは次の基準で指定してください。

- `--root` には、`pnpm --dir` で指定したスキルのディレクトリから対象リポジトリへの相対パスを渡します。上記の配置では `../../..` がリポジトリルートを指します。
- 末尾の対象ファイル・フォルダは、`--root` で指定したルートを基準にします。

変更分の検査も、変更行だけでなく選択されたファイル内の文章を対象とします。

## 対象と検査結果

Markdown・テキスト文書の本文と、JavaScript・TypeScript・Rust のコメントに対応しています。

JavaScript・TypeScript では、日本語の文字列リテラル、テンプレートの固定部分、JSX 本文も抽出します。これらの用語・AI スロップを検査し、文章用の textlint プリセットは適用しません。`textlint:review*` の実行時には、意味を確認するためのレビュー用データも出力します。

修正前に周辺コードと利用箇所を確認し、機械が読むキーやプロトコル値は維持します。自動置換は行いません。

箇条書きの文体は常体に固定せず、文書内での文体の混在を検査します。

検査対象からの除外は次のように扱います。

- 除外するファイルは、対象リポジトリのルートや各フォルダの `.textlintignore` に記述してください。パターンは配置先のフォルダを基準に評価し、配下に適用します。たとえば、このスキル内の `.textlintignore` に `/tests/` と書くと、スキル内のテストだけを除外します。
- 上位の設定を継承し、下位の設定を優先します。`!` で除外を解除できますが、除外したフォルダ内の設定は読み込みません。配下のファイルを対象に戻す場合は、親フォルダの除外も解除してください。
- `.git/`・`node_modules/`・`.textlint-cache/` は常に除外します。
- シンボリックリンクは追跡しません。

結果は対象リポジトリの `.textlint-cache/` に保存されます。このディレクトリは `.gitignore` に追加してください。

| ファイル                                    | 内容                                         |
| ------------------------------------------- | -------------------------------------------- |
| `review-changed.jsonl` / `review-all.jsonl` | 意味の確認に使う本文・ファイル名・行番号     |
| `issues-changed.json` / `issues-all.json`   | 英単語・識別子・不自然な日本語表現の候補一覧 |
| `technical-terms.json`                      | 取得済みの技術辞書                           |

変更ファイル用（`changed`）と全体用（`all`）では保存先が異なります。校正後は、変更ファイル用なら `textlint:changed`、全体用なら `textlint` で同じ対象を静的に検査してください。対応する古い指摘・レビュー用ファイルは検査前に削除されます。
対象ファイル・フォルダを変えても、同じ保存区分では出力先が共通なので、複数の校正を同時に実行しないでください。

終了コードは次のように確認してください。

- `0` でも、意味の校正が完了したとは限りません。`unknown-english` と `ai-slop` は確認候補であり、それだけでは失敗になりません。
- `ai-slop-pattern` は高確度の不自然な表現として、通常の静的検査も失敗させます。診断に従って元の文章と実装を確認し、意味を保って具体化してください。自動置換は行いません。
- `0` 以外の場合は、文章への指摘か実行エラーかを出力から確認してください。

キャッシュをまとめて削除する場合は、次を実行してください。技術辞書も削除されるため、次回は再取得が必要です。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:clean --root ../../..
```

## 参考にした考え方

[yomiyasu の意味保持・文体調整の指針](https://github.com/nanaism/yomiyasu/blob/main/SKILL.md)を参考に、`references/Proofreading.md` のルールを技術文書向けに整理しました。

[yomiyasu の技術記事向け指針](https://github.com/nanaism/yomiyasu/blob/main/references/domains/tech.md)を参考に、`references/Markdown.md` の導入・手順・装飾の見直しを整理しました。
数値による文体制限や記号の全面禁止は採用せず、読者の理解と Markdown の機能を優先しています。

校正に必要なルールはスキル内にまとめています。外部スキルの実行や参考元の読み込みは必要ありません。

## 不自然な日本語表現の追加・調整

`config/textlint-slop.json` の `reviewTerms` に文脈確認が必要な語を定義します。`reviewPatterns` は文脈確認が必要な正規表現、`patterns` は高精度で検出できる不自然な構文です。正規表現の各項目は `pattern` と診断用の `message` を持ち、Unicode モードで照合します。空文字列に一致するパターンは追加しないでください。

追加時は既存の textlint のプリセットと重複しないことを確認し、検出例・正当な用法・コードやリンク内の例をテストします。語だけでは正誤を決められない場合はレビュー候補にします。警告の数を減らすためだけに文章を変更せず、正当な用法なら維持してください。

検出器は既存の本文・コメントの抽出結果を使い、英単語チェックとコード・URL・リンク先の除外処理を共有します。文書のフェンスコード・HTML コメント・`texlint-ignore` 範囲は抽出時に除外します。引用内の識別子は保護しますが、その直前にある不自然な接頭辞は検査します。

候補は既存の `issues-changed.json` / `issues-all.json` に保存し、出現例は候補ごとに最大20件です。yomiyasu のカタログは参考資料として扱い、実行時には依存しません。

```sh
node --test .agents/skills/japanese-proofreading/tests/*.test.mjs
```

## 言語別のコメント抽出

`scripts/extractors/index.mjs` に拡張子と抽出処理が登録されています。
言語を追加する場合は、次の2つの関数を実装してください。

- `extractSourceComments(source, filePath)`
- `extractSourceIdentifiers(source, filePath)`

`extractSourceComments()` は元の行・列を保つ `lintText` と、本文・ファイル名・行番号を持つ `items` を返します。`extractSourceIdentifiers()` は識別子の収集結果を `Set` で返します。

文字列を抽出する言語では、`extractSourceTexts(source, filePath)` も実装します。戻り値は `file`・`startLine`・`endLine`・`kind`・`text` を持つ項目の配列です。現在は JavaScript・TypeScript に対応し、`kind` は `string`・`template-text`・`jsx-text` です。

式を含むテンプレートは固定部分ごとに分けて抽出します。エスケープシーケンスや JSX の文字参照は展開せず、元の表記を保ちます。Rust は文字列抽出に対応していないため、この API は空配列を返します。

- `typeScript.mjs`：TypeScript の構文木を使い、JavaScript・TypeScript・JSX・TSX を扱います。
- `rust.mjs`：`.rs` の字句を走査し、通常コメント・ドキュメントコメント・入れ子のブロックコメントを抽出します。

Rust の抽出処理では、次のように字句を扱います。

- 文字列、文字リテラル、バイト文字列、C 文字列、生文字列をコメントと区別します。
- 識別子はコメントと文字列以外の字句から収集します。
- 型や宣言の解決、マクロの展開、`#[doc = ...]` 属性の本文抽出には対応していません。
- 閉じていない文字列・ブロックコメントはエラーにし、検査済みとして扱いません。

字句の判断には [Rust Reference のトークン](https://doc.rust-lang.org/reference/tokens.html)と[コメント](https://doc.rust-lang.org/reference/comments.html)を参照しました。

## 今後の追加候補：Tree-sitter

対応言語が増えた場合は、Tree-sitter による構文解析の共通化を検討します。現時点では依存関係に追加していません。

採用時は次の点を確認・検証してください。

- 文法の配布・バージョン管理、Windows での導入方法、解析失敗時の扱いを確認します。
- バイト単位の位置と JavaScript の UTF-16 の位置を変換し、改行や絵文字があっても元の行・列を保ちます。
- 既存の抽出処理と同じ返却形式に合わせ、文字列の誤検出、ドキュメントコメント、識別子の収集を言語ごとに検証します。

## 抽出処理の検証

次のテストは、文字列内の記号をコメントと誤認する不具合や、元コードの行・列がずれる不具合を検出します。抽出処理の変更時に、リポジトリルートから実行してください。

```sh
node --test .agents/skills/japanese-proofreading/tests/extractors.test.mjs
```

<!-- textlint-enable ja-technical-writing/no-mix-dearu-desumasu -->

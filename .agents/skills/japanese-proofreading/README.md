<!-- textlint-disable ja-technical-writing/no-mix-dearu-desumasu -->

# 日本語校正スキル

ソースコードのコメント・文字列・画面表示の文言や、README・Markdown 文書の日本語を、まとまった変更の後に校正するスキルです。
静的検査に加え、エージェントが周辺コードや文章を読み、説明と実装の一致や文章の読みやすさを確認します。
通常の実装や `pnpm package` では自動実行せず、校正を依頼したときに使います。

この README は利用者・保守者向けの案内です。エージェントの実行手順は [SKILL.md](SKILL.md) にまとめています。

## セットアップ

実行環境は Windows です。Node.js 22.19.0 以降と pnpm が必要です。
変更ファイルの自動抽出には、1件以上のコミットがある Git リポジトリも必要になります。

別のリポジトリへ導入する場合は、スキル一式を `.agents/skills/japanese-proofreading/` にコピーします。
コピー対象から `node_modules/` と生成済みの `config/technical-terms.json` を除いてください。
コピー先が pnpm ワークスペースの場合は、その `pnpm-workspace.yaml` の `packages` にスキルのディレクトリも登録してください。本リポジトリでは登録済みです。

スキルを配置したリポジトリのルートから次を実行してください。

```sh
pnpm --dir .agents/skills/japanese-proofreading install
```

`--dir` はコマンドの実行ディレクトリを指定します。ワークスペース内では、標準の設定でワークスペース全体の依存関係がインストール対象になります。
Windows で PowerShell の実行ポリシーにより起動できない場合は、`pnpm` を `pnpm.cmd` に置き換えてください。

外部の技術辞書は、最初の検査時に取得し、キャッシュに保存します。
取得条件と更新手順は[技術辞書の取得・更新](#技術辞書の取得更新)を参照してください。

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

`run.cmd` の第1引数に、スキル内の `package.json` に定義されたスクリプト名を指定します。
続けて追加オプションや対象ファイル・フォルダを渡してください。対象パスはリポジトリルートが基準です。

スキルを `.agents/skills/japanese-proofreading/` に配置すると、`run.cmd` が自身の場所からリポジトリルートを求め、`--dir` と `--root` を補います。
サブディレクトリから呼び出す場合も、対象パスの基準は変わりません。

### コマンドの選択

対象ファイル・フォルダを指定しない場合、各コマンドは次の処理を実行します。

|コマンド名|処理|
|-------------------------|-----------------------------------------------------------|
|`textlint:changed`|HEAD との差分に含まれるファイルと未追跡ファイルを静的に検査|
|`textlint:review:changed`|HEAD との差分に含まれるファイルと未追跡ファイルの静的検査とレビュー用データの生成|
|`textlint`|リポジトリ全体を静的に検査|
|`textlint:review`|全体の静的検査とレビュー用データの生成|
|`textlint:clean`|対象リポジトリの検査用キャッシュを削除|

ファイルやフォルダを指定すると、Git の変更状態に関係なく指定範囲を検査します。複数の対象を並べることもできます。
変更分の検査も、変更行だけでなく選択されたファイル内の文章を対象とします。
`textlint:clean` は対象パスを受け取りません。

### 変更分を校正する

変更分のレビュー用データを生成し、校正後に同じ対象を再検査する例です。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review:changed
# エージェントがレビュー用データと元ファイルを確認し、校正します。
.\.agents\skills\japanese-proofreading\run.cmd textlint:changed
```

### 指定した範囲を校正する

指定範囲のレビュー用データを生成し、校正後に同じ対象を再検査する例です。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review README.md packages/shared/src
# 校正後も同じ対象を指定してください。
.\.agents\skills\japanese-proofreading\run.cmd textlint README.md packages/shared/src
```

## 対象と検査結果

### 検査対象

対応する文書・言語と抽出範囲は次のとおりです。

|文書・言語|抽出する範囲|
|---|---|
|Markdown・テキスト文書|本文|
|JavaScript・TypeScript（JSX・TSX を含む）|コメント・JSDoc・文字列・テンプレートの固定部分・JSX 本文|
|Svelte|HTML コメント、`script` 内・テンプレート式内のコメントと文字列、要素の本文・属性値|
|Rust|通常コメント・ドキュメントコメント・入れ子のブロックコメント|

日本語を含む文書の本文やソースコードのコメントには、文章用の textlint プリセットも適用します。
文字列・テンプレートの固定部分・JSX 本文・Svelte の本文と属性値では、用語と AI に特有の不自然な表現を検査します。
これらには文章用の textlint プリセットを適用せず、`textlint:review*` の実行時にレビュー用データも出力します。
Svelte の `style` 内は抽出しません。

修正前に周辺コードと利用箇所を確認し、機械が読むキーやプロトコル値は維持します。自動置換は行いません。

箇条書きの文体は常体に固定せず、文書内での文体の混在を検査します。

### 検査対象からの除外

除外するファイルは、対象リポジトリのルートや各フォルダの `.textlintignore` に記述してください。
パターンは配置先のフォルダを基準に評価し、配下に適用します。
たとえば、このスキル内の `.textlintignore` に `/tests/` と書くと、スキル内のテストだけを除外します。

|設定・対象|扱い|
|---|---|
|上位と下位の `.textlintignore`|上位の設定を継承し、下位の設定を優先します|
|`!` で始まるパターン|除外を解除します|
|除外されたフォルダ|内部の設定は読み込みません。配下を検査対象に戻す場合は、親フォルダの除外も解除してください|
|`.git/`・`node_modules/`・`.textlint-cache/`|常に除外します|
|シンボリックリンク|追跡しません|

### 結果の保存と再検査

結果は対象リポジトリの `.textlint-cache/` に保存されます。このディレクトリは `.gitignore` に追加してください。

|ファイル|内容|
|-------------------------------------------|--------------------------------------------|
|`review-changed.jsonl` / `review-all.jsonl`|意味の確認に使う本文・ファイル名・行番号|
|`issues-changed.json` / `issues-all.json`|英単語・識別子・不自然な日本語表現の候補一覧|

変更ファイル用（`changed`）と全体用（`all`）では保存先が異なります。
校正後は、レビュー用データを生成したコマンドに対応する静的検査を、同じ対象へ実行してください。

|レビュー用データの生成|校正後の静的検査|
|---|---|
|`textlint:review:changed`|`textlint:changed`|
|`textlint:review`|`textlint`|

対応する古い指摘・レビュー用ファイルは検査前に削除されます。
同じ保存区分では、対象ファイル・フォルダを変えても出力先が共通です。複数の校正を同時に実行しないでください。

### 指摘と終了コードの確認

|指摘の種類|扱い|
|---|---|
|`unknown-english`・`ai-slop`|確認候補です。この指摘だけではコマンドは失敗しません|
|`ai-slop-pattern`|不自然な表現を高い確度で検出した指摘です。通常の静的検査も失敗させます|

終了コードが `0` でも、文章の意味の確認が完了したとは限りません。
`0` 以外の場合は、文章への指摘か実行エラーかを出力から確認してください。
表現への指摘は元の文章と実装を照合し、意味を保って修正します。自動置換は行いません。

### キャッシュの削除

プロジェクト側の検査結果とレビュー用データをまとめて削除する場合は、次を実行してください。
スキル側の技術辞書キャッシュは保持します。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:clean
```

## プロジェクトごとの設定

用語とレビュー範囲の設定は、対象リポジトリのルートに置く `.textlint-project.json` で管理します。

|設定項目|指定する内容|省略時の扱い|
|---|---|---|
|`allowedEnglish`|固有名詞など、英語のまま使うことを許可する語の配列|追加の許可語なし|
|`preferredJapanese`|英単語と推奨する日本語表記の対応|追加の推奨表記なし|
|`reviewOnlySourceTexts`|コメント以外の文言をレビューだけで扱うパスの配列|すべての文言を静的検査の対象にします|

ファイル自体がない場合も、各項目を省略した場合と同じ扱いになります。
`preferredJapanese` は、許可語・自動取得した語彙・識別子の判定より優先します。
技術辞書の取得元は、スキル内の `config/.textlintrc.json` の `technicalDictionary` で管理します。

### コメント以外の文言をレビューだけで扱う

検証用の文字列やコード例を多く含む領域で、コメント以外の文言を静的検査から外す場合は、`reviewOnlySourceTexts` に対象のパターンを指定してください。

```json
{
  "reviewOnlySourceTexts": ["apps/nerita-ui/stories/"]
}
```

パターンはリポジトリルートを基準にした Git の除外パターン形式です。
この設定は、変更分・全体の静的検査とレビュー用データの生成に適用されます。

|設定・対象|静的検査とレビュー用データの扱い|
|---|---|
|パターンに一致するソースファイルのコメント|通常どおり静的に検査します|
|パターンに一致するソースファイルの文字列・テンプレートの固定部分・JSX 本文・Svelte の本文と属性値|用語と AI に特有の不自然な表現の静的検査から外します。`textlint:review*` の JSONL には残します|
|設定がない場合や、パターンに一致しないソースファイル|コメント以外の文言も静的に検査します|
|Markdown・テキスト文書、`.textlintignore` によるファイルの選別|この設定の影響を受けません|

静的検査から外した文言は、レビュー用データを確認し、必要な場合だけ校正します。
パス・生成コード・検証入力の値は維持してください。
不正な設定や、設定ファイルのシンボリックリンクはエラーになります。

## 技術辞書の取得・更新

`technicalDictionary` は取得元を指定する手動設定です。この設定自体を自動生成・更新するコマンドはありません。
取得元は GitHub の [streetsidesoftware/cspell-dicts](https://github.com/streetsidesoftware/cspell-dicts) です。
取得した辞書から語彙を抽出し、スキル内の `config/technical-terms.json` を自動生成します。
このファイルはスキル内の `.gitignore` で除外し、Git には登録しません。

|項目|管理方法|
|---|---|
|`config/.textlintrc.json` の `technicalDictionary.revision`|取得する `cspell-dicts` のコミット SHA を指定します|
|`config/.textlintrc.json` の `technicalDictionary.files`|取得する辞書ファイルを、`cspell-dicts` のルートからの相対パスで指定します|
|スキル内の `config/technical-terms.json`|取得・抽出した語彙と、生成時のリビジョン・ファイル一覧を保存します。直接編集せず、検査時に生成します|

### キャッシュを生成するタイミング

検査対象がある状態で `textlint`・`textlint:changed`・`textlint:review`・`textlint:review:changed` を実行すると、辞書キャッシュを確認します。

|キャッシュの状態|処理|
|---|---|
|初回など、キャッシュがない場合|設定されたリビジョンの辞書を取得し、キャッシュを生成します|
|リビジョン・ファイル一覧が設定と一致し、キャッシュ形式も有効な場合|保存済みの語彙を使います。上流の最新版は確認しません|
|リビジョンやファイル一覧を変更した場合、キャッシュが壊れている場合|辞書を取得し直し、キャッシュを置き換えます|

`pnpm install` や `spec:lint` では、このキャッシュを生成しません。
取得できない場合は警告を表示し、外部辞書なしで検査を続けます。次の検査時に取得を再試行します。

### 辞書を更新する手順

1. `cspell-dicts` で採用するコミットの SHA を確認します。
2. スキル内の `config/.textlintrc.json` の `technicalDictionary.revision` を変更します。取得対象も変える場合は `files` を編集してください。
3. 対象を指定して検査します。設定とキャッシュの不一致を検出するため、事前のキャッシュ削除は不要です。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint README.md
```

辞書の更新により、英単語の確認候補も変わることがあります。検査結果を確認してから設定の変更を確定してください。
同じリビジョンから再取得したい場合は、スキル内の `config/technical-terms.json` を削除して再検査します。
`textlint:clean` はプロジェクト側の検査結果とレビュー用データだけを削除し、この辞書キャッシュは保持します。

## 不自然な日本語表現の追加・調整

`config/textlint-slop.json` で、不自然な日本語表現の検出条件を定義します。

|設定項目|定義する内容|
|---|---|
|`reviewTerms`|文脈確認が必要な語|
|`reviewPatterns`|文脈確認が必要な表現を検出する正規表現|
|`patterns`|不自然な構文を高い確度で検出する正規表現|

正規表現の各項目は `pattern` と診断用の `message` を持ち、Unicode モードで照合します。
空文字列に一致するパターンは追加しないでください。

追加時は既存の textlint のプリセットと重複しないことを確認し、検出例・正当な用法・コードやリンク内の例をテストします。
語だけでは正誤を決められない場合はレビュー候補にします。警告の数を減らすためだけに文章を変更せず、正当な用法なら維持してください。

検出器は既存の本文・コメントの抽出結果を使い、英単語チェックとコード・URL・リンク先の除外処理を共有します。
文書のフェンスコード・HTML コメント・`texlint-ignore` 範囲は抽出時に除外します。
引用内の識別子は保護しますが、その直前にある不自然な接頭辞は検査します。

候補は既存の `issues-changed.json` / `issues-all.json` に保存し、出現例は候補ごとに最大20件です。yomiyasu のカタログは参考資料として扱い、実行時には依存しません。

```sh
node --test .agents/skills/japanese-proofreading/tests/*.test.mjs
```

## 言語別のコメント・文言抽出

`scripts/extractors/index.mjs` に拡張子と抽出処理が登録されています。
言語を追加する場合は、次の関数を実装してください。

|関数|実装する条件|戻り値|
|---|---|---|
|`extractSourceComments(source, filePath)`|すべての言語で必須|元の行・列を保つ `lintText` と、本文・ファイル名・行番号を持つ `items`|
|`extractSourceIdentifiers(source, filePath)`|すべての言語で必須|収集した識別子の `Set`|
|`extractSourceTexts(source, filePath)`|文字列や表示文言も抽出する場合|`file`・`startLine`・`endLine`・`kind`・`text` を持つ項目の配列|

抽出処理と `kind` の対応は次のとおりです。

|抽出処理のファイル|対応言語と範囲|文字列・表示文言の `kind`|
|---|---|---|
|`typeScript.mjs`|TypeScript の構文木で JavaScript・TypeScript・JSX・TSX を解析します|`string`・`template-text`・`jsx-text`|
|`svelte.mjs`|Svelte の構文木からコメント・本文・属性値を抽出し、埋め込みコードは TypeScript の抽出処理で解析します|`string`・`template-text`・`svelte-text`・`svelte-attribute`|
|`rust.mjs`|`.rs` の字句を走査し、通常コメント・ドキュメントコメント・入れ子のブロックコメントを抽出します|文字列抽出には未対応です。公開 API の `extractSourceTexts()` は空配列を返します|

式を含むテンプレートは固定部分ごとに分けて抽出します。
エスケープシーケンスや文字参照は展開せず、元の表記を保ちます。

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

## 参考にした考え方

[yomiyasu の意味保持・文体調整の指針](https://github.com/nanaism/yomiyasu/blob/main/SKILL.md)を参考に、`references/Proofreading.md` のルールを技術文書向けに整理しました。

[yomiyasu の技術記事向け指針](https://github.com/nanaism/yomiyasu/blob/main/references/domains/tech.md)を参考に、`references/Markdown.md` の導入・手順・装飾の見直しを整理しました。
数値による文体制限や記号の全面禁止は採用せず、読者の理解と Markdown の機能を優先しています。

校正に必要なルールはスキル内にまとめています。外部スキルの実行や参考元の読み込みは必要ありません。

<!-- textlint-enable ja-technical-writing/no-mix-dearu-desumasu -->

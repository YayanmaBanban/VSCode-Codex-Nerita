# 日本語校正スキルの参考元

この文書はスキルの保守用に参考元と採用方針を記録する。校正時に読む必要はない。

## 参考にした考え方

[yomiyasu の意味保持・文体調整の指針](https://github.com/nanaism/yomiyasu/blob/main/SKILL.md)を参考に、`references/Proofreading.md` のルールを技術文書向けに整理した。

[yomiyasu の技術記事向け指針](https://github.com/nanaism/yomiyasu/blob/main/references/domains/tech.md)を参考に、`references/Markdown.md` の導入・手順・装飾の見直しを整理した。
数値による文体制限や記号の全面禁止は採用せず、読者の理解と Markdown の機能を優先する。

校正に必要なルールはスキル内にまとめている。外部スキルの実行や参考元の読み込みは必要ない。

## 言語別のコメント抽出

`scripts/extractors/index.mjs` に拡張子と抽出処理が登録されている。
言語を追加する場合は、次の2つの関数を実装する。

- `extractSourceComments(source, filePath)`
- `extractSourceIdentifiers(source, filePath)`

コメント抽出は元の行・列を保つ `lintText` と、本文・ファイル名・行番号を持つ `items` を返す。識別子の収集結果は `Set` で返す。

- `typeScript.mjs`：TypeScript の構文木を使い、JavaScript・TypeScript・JSX・TSX を扱う。
- `rust.mjs`：`.rs` の字句を走査し、通常コメント・ドキュメントコメント・入れ子のブロックコメントを抽出する。

Rust の抽出処理では、次のように字句を扱う。

- 文字列、文字リテラル、バイト文字列、C 文字列、生文字列をコメントと区別する。
- 識別子はコメントと文字列以外の字句から収集する。
- 型や宣言の解決、マクロの展開、`#[doc = ...]` 属性の本文抽出には対応していない。
- 閉じていない文字列・ブロックコメントはエラーにし、検査済みとして扱わない。

字句の判断には [Rust Reference のトークン](https://doc.rust-lang.org/reference/tokens.html)と[コメント](https://doc.rust-lang.org/reference/comments.html)を参照した。

## 今後の追加候補：Tree-sitter

対応言語が増えた場合は、Tree-sitter による構文解析の共通化を検討する。現時点では依存関係に追加していない。

採用時は次の点を確認・検証する。

- 文法の配布・バージョン管理、Windows での導入方法、解析失敗時の扱いを確認する。
- バイト単位の位置と JavaScript の UTF-16 の位置を変換し、改行や絵文字があっても元の行・列を保つ。
- 既存の抽出処理と同じ返却形式に合わせ、文字列の誤検出、ドキュメントコメント、識別子の収集を言語ごとに検証する。

## 抽出処理の検証

次のテストは、文字列内の記号をコメントと誤認する不具合や、元コードの行・列がずれる不具合を検出する。抽出処理の変更時に、リポジトリルートから実行する。

```sh
node --test .agents/skills/japanese-proofreading/tests/extractors.test.mjs
```

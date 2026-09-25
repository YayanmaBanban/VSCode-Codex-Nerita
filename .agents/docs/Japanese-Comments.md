## 日本語 textlint

日本語のコメント、JSDoc、Markdown、テキスト文書を
作成または変更した場合は、作業完了前に textlint を実行する。

通常の作業では次を使用する。

    pnpm textlint:changed

リポジトリ全体を確認する場合のみ次を使用する。

    pnpm textlint

`.textlintignore` に含まれるファイルやディレクトリは
textlint の対象外とする。

### textlint の修正方針

textlint が英語・識別子と日本語の不自然な接続を報告した場合、
単純な文字置換ではなく、周囲のコードと文章を確認して修正する。

コード上の識別子、型名、関数名、API 名、コマンド名、
製品名、ライブラリ名、プロトコル名などは、
実際の名称である場合は翻訳しない。

一般的な日本語訳が定着している自然言語上の技術用語は、
自然な日本語へ置き換える。

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

textlint の警告を機械的に修正しない。
コード上の意味を確認してから修正する。

修正後は次のコマンドを再実行し、対象となる警告が解消されたことを確認する。

    pnpm textlint:changed
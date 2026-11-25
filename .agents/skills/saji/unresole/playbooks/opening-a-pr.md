> **未解決のため実行できません。** このPlaybookにはユーザー判断が必要な事項があります。実行を開始せず、未解決のため実行できないことをユーザーに伝えて停止してください。以下は変更せず保持した原文の日本語訳です。

### PRの作成（Opening a PR）

ほかの各Playbookの終了時に呼び出される。

trunkから分岐したGit worktreeで作業し、無関係な変更を含めない。リベースして、小さくマージ可能なコミットに整理する。コミット前に`cursor-team-kit`の`/deslop`を差分へ適用する。

タイトルは`type(scope): subject`形式とし、変更を代表する実際のシンボルがあるならそれを含める。本文は40行未満で、1分程度で把握できる説明にする。見出しは`##`形式で、`## Why`、`## What changed`、`## Scope`、`## Tradeoffs`（レビュー担当が尋ねそうな不採用案だけ）、`## Blast Radius`、`## Verification`の順とし、空の節は除く。

後続変更はベースブランチでスタックする。PRはDraftではなく、レビュー可能な状態で開く。実行中のPRツールで`draft: false`を指定する。ツールがなければ`gh pr create`で`--draft`を付けずに作成するか、OriginのCLIがリポジトリを解決できる場合は`origin pr create --status open`を使う。PRの作成だけでBabysitは開始しない。

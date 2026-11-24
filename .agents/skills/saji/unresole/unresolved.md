# 未解決事項一覧

このフォルダの各Markdownは、Pi/Codexでの実行方法や権限について**未決事項があるため隔離**している。これらのMarkdownを選択した場合は、ファイル先頭の警告に従ってユーザーに未解決であることを伝え、**実行を開始せず停止する**。

原文に沿った日本語訳は本文として維持しており、未解決部分を独自の「代替手段」「無効化」「省略」に書き換えていない。解決方法を決めるのは、利用環境の事実確認と、必要な場合のユーザー判断を経た後とする。

## Playbook（22件）

| Markdown | 未解決の内容・確認すべき判断 |
| --- | --- |
| [`investigation.md`](playbooks/investigation.md) | 設計理由を調べる`why`と文章校正`unslop`の導入・起動方法 |
| [`bug-fix.md`](playbooks/bug-fix.md) | 実環境操作のcontrol Skill、`why`・`architect`・`tdd`、Cursorの`/loop`、委譲モデルとコミット・PR権限 |
| [`perf-issue.md`](playbooks/perf-issue.md) | control Skillによる計測、`benchmark-checklist`、`architect`、実装委譲モデル、PR作成方法 |
| [`hillclimb.md`](playbooks/hillclimb.md) | 計測の専門Skill、`show-me-your-work`、反復・並列委譲の実行方式、モデル指定とコミット・PR権限 |
| [`runtime-forensics.md`](playbooks/runtime-forensics.md) | 動作中のプロセスを操作・計測するcontrol Skillと、大きな成果物を調べるサブエージェント |
| [`trace-forensics.md`](playbooks/trace-forensics.md) | 大量のトレース・ヒープ解析を分担するサブエージェントの起動方法 |
| [`feature.md`](playbooks/feature.md) | `architect`・`arena`・`interrogate`、役割別委譲モデル、実動作検証手段、コミット・PR権限 |
| [`refactoring.md`](playbooks/refactoring.md) | `architect`、機械的編集の委譲モデル、control Skillによる同等性検証、コミット・PR権限 |
| [`prototype.md`](playbooks/prototype.md) | 画面操作用control Skillと、Pi/Codexで用いる隔離された試作環境 |
| [`visual-parity.md`](playbooks/visual-parity.md) | ピクセル差分のcontrol Skill、Cursorの`/loop`、PR作成方法 |
| [`authoring-a-skill.md`](playbooks/authoring-a-skill.md) | Cursor組み込み`create-skill`をPi/Codexでどう実装・利用するか |
| [`eval.md`](playbooks/eval.md) | 複数モデルの`arena`起動、候補・Judgeのモデル、トランスクリプト保存場所と匿名化方法 |
| [`babysit.md`](playbooks/babysit.md) | 未同梱の`scripts/watch-pr/watch-pr`、Origin/GitHub CLIの選択、Bugbot連携、PR書き込み権限 |
| [`shipping.md`](playbooks/shipping.md) | Cursorクラウドエージェント、control Skill、独立検証担当、Origin/GitHub CLI、スタック監視とマージ権限 |
| [`autonomous-run.md`](playbooks/autonomous-run.md) | Cursorの`/loop`に相当する継続起動・イベント監視、無人委譲、コミット・PR操作の権限 |
| [`autopilot-full.md`](playbooks/autopilot-full.md) | Cursorクラウドエージェント、実行状態の保存先、`/loop`、複数担当と独立検証、PR・マージの権限 |
| [`autopilot-stack.md`](playbooks/autopilot-stack.md) | Autopilot-fullに含まれる未決事項、PRの積み直しと監視、マージ禁止と権限の整合 |
| [`session-pickup.md`](playbooks/session-pickup.md) | Cursorの`agent-transcripts/`やクラウドエージェントURLに相当するPi/Codexの履歴取得場所 |
| [`pause-safely.md`](playbooks/pause-safely.md) | 原文の自動`wip:`コミット・Pushとユーザー承認の整合、再開記録の保存先 |
| [`multi-phase-plan.md`](playbooks/multi-phase-plan.md) | Prototypeの利用方法、計画ファイルとPR識別子の扱い、実動作・性能検証に必要な環境 |
| [`worktree-cleanup.md`](playbooks/worktree-cleanup.md) | 未同梱の`scripts/worktree-audit.sh`、Cursorのチャット利用状況、macOSシミュレーター、削除権限 |
| [`opening-a-pr.md`](playbooks/opening-a-pr.md) | `/deslop`、Cursor/Origin/GitHubのPR操作、コミット・PR作成の承認範囲 |

## 参照文書（1件）

| Markdown | 未解決の内容・確認すべき判断 |
| --- | --- |
| [`delegation.md`](references/delegation.md) | 原文の`poteto-agent`・`Task`・`run_in_background`・`setup-pstack`・固定モデル設定に対して、カスタムPiとCodexで実在するエージェント・ツール・モデル・推論設定を特定する |

## Principle（4件）

| Markdown | 未解決の内容・確認すべき判断 |
| --- | --- |
| [`type-system-discipline.md`](principles/type-system-discipline.md) | TypeScript用`typescript-best-practices` Skillの導入先と、構文に関する具体ルールの参照方法 |
| [`explain-the-number.md`](principles/explain-the-number.md) | `benchmark-checklist` Skillの導入・実行方法（性能数値の精査が必要） |
| [`guard-the-context-window.md`](principles/guard-the-context-window.md) | 大量の読込結果を渡すサブエージェントと、読み取り専用委譲・返答の受け渡し方法 |
| [`never-block-on-the-human.md`](principles/never-block-on-the-human.md) | 原文の『元に戻せるコード変更は確認なく進める』と、現行のユーザー承認ルールの衝突をどう解消するか |

## 解決・復帰の条件

実際のカスタムPi/Codexのツール定義・設定・インストール済みSkillを確認し、未決の判断はユーザーと合意する。その後、必要な実行環境を整え、原文の工程や例外を保ったまま動作を確認する。解決したMarkdownだけを通常の`playbooks/`・`references/`・`principles/`へ戻し、参照元のリンクを更新する。

単に実行できないコマンドを読み飛ばした、同等の検証がないまま別の手順へ変更した、という状態は**解決に含めない**。

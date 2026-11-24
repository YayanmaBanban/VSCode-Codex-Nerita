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

## 専門Skill（27件）

| 対象Markdown | 未解決の内容・判断が必要な事項 |
| --- | --- |
| [`architect/SKILL.md`](skills/architect/SKILL.md) | Arenaへの委譲と設計比較の実行手段が未決 |
| [`arena/SKILL.md`](skills/arena/SKILL.md) | CursorのTask、候補モデル、審査担当の独立性、分離したworktree、役割別設定が未決 |
| [`swarm/SKILL.md`](skills/swarm/SKILL.md) | Taskサブエージェント、クラウド/ローカル環境、並列起動、役割モデル、ブランチ選択が未決 |
| [`interrogate/SKILL.md`](skills/interrogate/SKILL.md) | Arena依存、異なるレビュー用モデル、並列worktree、未コミット差分の隔離が未決 |
| [`figure-it-out/SKILL.md`](skills/figure-it-out/SKILL.md) | 未解決の委譲・Arena・監査Skillと、長期自律実行・PRの権限が未決 |
| [`benchmark-checklist/SKILL.md`](skills/benchmark-checklist/SKILL.md) | Unix系`uptime`・`nproc`・`pidstat`・`perf`・`strace`等の計測ツールをWindows/Pi/Codexでどう実行するか未決 |
| [`no-comments/SKILL.md`](skills/no-comments/SKILL.md) | 固定名`comment-sicko`サブエージェント、Task呼び出し、レビュー反映と承認範囲が未決 |
| [`typescript-best-practices/SKILL.md`](skills/typescript-best-practices/SKILL.md) | frontmatterの`paths`による自動適用と、未解決のtype-system-discipline Principleの適用関係が未決。コード例は収録済み |
| [`correct/SKILL.md`](skills/correct/SKILL.md) | 履歴の調査手段、Lint/CIへの書き込み、各修正の自動コミットと承認範囲が未決 |
| [`reflect/SKILL.md`](skills/reflect/SKILL.md) | Cursor会話履歴の取得、CursorのSkillディレクトリと承認後の編集方法が未決 |
| [`blast-radius/SKILL.md`](skills/blast-radius/SKILL.md) | 大規模変更で必須となるArenaの分担実行・モデル指定が未決 |
| [`reframe/SKILL.md`](skills/reframe/SKILL.md) | 出典のリンクを実際に開き検証するための外部検索・ブラウザーの利用方法が未決 |
| [`how/SKILL.md`](skills/how/SKILL.md) | 読み取り専用の`Task`・`generalPurpose`エージェントの起動方法が未決 |
| [`recall/SKILL.md`](skills/recall/SKILL.md) | Cursorのトランスクリプト保存先、履歴のスコープ、並列調査・MCPアクセスの方式が未決 |
| [`ketchup/SKILL.md`](skills/ketchup/SKILL.md) | チャット全履歴の取得・スクリーンショット埋め込み・図表生成/`/visualize`の利用方式が未決 |
| [`ketchup-video/SKILL.md`](skills/ketchup-video/SKILL.md) | スライド動画の描画、字幕とフレーム検証、チャットへの動画埋め込み方法が未決 |
| [`setup-pstack/SKILL.md`](skills/setup-pstack/SKILL.md) | `.cursor/rules/pstack-models.mdc`とCursorモデル識別子・`Task`の代わりとなる設定方法が未決 |
| [`automate-me/SKILL.md`](skills/automate-me/SKILL.md) | Cursorトランスクリプトの発掘、`AskQuestion`、組み込み`create-skill`、Skill配置先、コミット/PR権限が未決 |
| [`make-bot-ui/SKILL.md`](skills/make-bot-ui/SKILL.md) | Cursorの`update_state`・`SendToUser`秘密情報要求・Grok Bot Webhook・Tailscaleと安全な利用方法が未決 |
| [`teach/SKILL.md`](skills/teach/SKILL.md) | 未解決の`how`や、実装の図を段階的に生成する画像生成手段と呼び出し方式が未決 |
| [`show-me-your-work/SKILL.md`](skills/show-me-your-work/SKILL.md) | 補助スクリプト・Cursor会話履歴・別ベンダーモデルによる監査・コミット承認が未決 |
| [`create-verification-skill/SKILL.md`](skills/create-verification-skill/SKILL.md) | `.cursor/skills/verify-*`配置先、実際のアプリ操作機構、生成Skillを通し検証する環境が未決。機能マップの例は収録済み |
| [`maintain-verification-skill/SKILL.md`](skills/maintain-verification-skill/SKILL.md) | 独立サブエージェントでの全機能調査、実際の操作環境、書き込みとPR作成の権限が未決 |
| [`create-formal-verification-skill/SKILL.md`](skills/create-formal-verification-skill/SKILL.md) | TLA+・TLCなどの正式検証器、生成Skillの配置、statechart依存、製品コードの一時的変更への権限が未決 |
| [`maintain-formal-verification-skill/SKILL.md`](skills/maintain-formal-verification-skill/SKILL.md) | モデルチェッカー、コードへの反例の再現、同期コミット管理と検証Skillの書き込み権限が未決 |
| [`statechart/SKILL.md`](skills/statechart/SKILL.md) | TLA+・TLC・Java・mise・Pele・statechartスクリプトと依存モジュールの配備、OS差が未決 |
| [`poteto-help/SKILL.md`](skills/poteto-help/SKILL.md) | Cursor固有のCustom Mode、`/setup-pstack`、`/poteto-mode`とGuideの参照先をsajiでどう扱うか未決 |

### 同梱した補助資料と未導入の実行資産

- `typescript-best-practices/references/patterns.md`：日本語訳とTypeScriptコード例を収録。コード例の非コメント部分は原文と一致。
- `create-verification-skill/references/feature-map-example/`：3件の日本語訳を収録。機能ID・コマンド・UIラベルを保持。
- `poteto-help/references/`：依頼文の書き方と例を日本語訳で収録。
- `statechart/references/render.md`：日本語訳を収録。CSSは原文どおり。
- `show-me-your-work/references/decision-log-template.tsv`：列名とTSV形式を原文どおり保持。
- **未導入：** pstackの`statechart/scripts/`の実行プログラムと依存モジュール、`show-me-your-work/scripts/log.sh`など。存在しないスクリプトを実行済みとは扱わない。

## 解決・復帰の条件

実際のカスタムPi/Codexのツール定義・設定・インストール済みSkillを確認し、未決の判断はユーザーと合意する。その後、必要な実行環境を整え、原文の工程や例外を保ったまま動作を確認する。解決したMarkdownだけを通常の`playbooks/`・`references/`・`principles/`へ戻し、参照元のリンクを更新する。

単に実行できないコマンドを読み飛ばした、同等の検証がないまま別の手順へ変更した、という状態は**解決に含めない**。

# pstackの参照元と変更点

このディレクトリは、pstackを基に改変した配布物である。

- 参照元：https://github.com/cursor/plugins/tree/005d8f6e8ec057b738adcd08a08b30db0478402d/pstack
- 参照元コミット：`005d8f6e8ec057b738adcd08a08b30db0478402d`（固定。更新される`main`を参照しない）
- 原文のライセンス：MIT、Copyright (c) 2026 Lauren Tan。法的な原文は`LICENSE.pstack`に保持する。
- 原文ファイル：`skills/poteto-mode/SKILL.md`、`skills/poteto-mode/worker.md`、`skills/poteto-mode/playbooks/*.md`の22本、`skills/principle-*/SKILL.md`の24本。

## 明示的な変更内容

1. 入口Skillを`poteto-mode`から`saji`へ変更。原文のNon-negotiablesの発動条件を入口に維持し、Principles、Autonomy、Subagents、Writing the reply、Playbooksを個別の参照ファイルへ分離した。
2. 原文のGuideにある「複数工程ではPrincipleの全一覧を最初に確認し、Playbookの全工程をToDoへ展開する」動作を追加。見出しと入れ子のチェック項目を短縮しない。
3. Cursor固有の`poteto-agent`、モデル識別子、`Task`引数、設定ファイルの前提を、`references/delegation.md`と実行環境の互換性を一括管理していた旧リファレンス（廃止）で実行環境の能力に置き換えた。役割設定用のJSONは作らない。
4. 自律実行規則と`worker.md`の権限を厳格化した。コミット・Push・PR操作にはユーザーの許可が必要。原文にある自律的なコミットや出荷の指示に優先する。
5. 22本のPlaybookの工程と下位項目を保持して移植した。固定モデル識別子は`<role-model>`へ置換し、選択方法は`references/delegation.md`で扱う。
6. 24個のPrincipleの本文全体を`principles/*.md`へ収録し、Cursor専用のfrontmatterを除去した。適用条件は`references/principles.md`で管理する。
7. `architect`、`swarm`、`arena`、`how`、`interrogate`などの専門Skillや外部`cursor-team-kit`の実装は、**ここには同梱していない**。導入・移植されるまでは、関連工程は未解決の依存条件であり、実行済みとは扱わない。
8. 原文の自然言語を日本語化した。Skill名、ファイルパス、コマンド、固定の機械的識別子は保持する。原文の工程・判定条件・制約を省略しない。
9. Babysit Playbookから参照される原文の`references/bugbot-triage.md`も日本語化して追加した。ライセンス原文を維持し、別途`LICENSE.pstack.ja.md`に参考訳を加えた。

pstack由来の文書が存在することを、製品のビルド成功や実行時テストの合格と混同しない。


---

## 当初の環境適合表（移植の作業記録・運用規則ではない）


この規則は、固定したpstack原文にあるCursor固有の指示をPi/Codexへ読み替えるためのもの。Playbookの工程を削除したり、求められる検証内容を変更したりするものではない。

## 優先順序

1. 実行できる変更の範囲は、ユーザーの明示的な許可と、現在のリポジトリ規約で決める。
2. `references/autonomy.md`と`worker.md`で権限境界を定義する。原文Playbookの「積極的にコミットする」「Opening a PR」「Shipping」という指示だけでは、コミット・Push・マージの権限を与えない。
3. 選択したPlaybookの工程を元の順番どおりに実行する。現在の実行環境に存在しない実行手段だけを置き換える。利用できないツールやエージェント、実行していないチェックを実行済みだと主張しない。
4. 置き換えた実行方法や実行できなかった工程は、作業報告に具体的に残す。元のPlaybookへ汎用的な追加規則を勝手に持ち込まない。

## 実行環境ごとの対応

| pstack原文の仕組み | Pi / Codexでの扱い |
| --- | --- |
| Cursorの`Task`、`subagent_type`、Projectワーカー | 対応する固定名エージェントが定義されていれば使う。なければ利用可能な委譲先を使うか、Playbookで必要な独立レビューを維持したうえで親が実施する |
| 固定のOpus / Gemini / Fableモデル識別子と`-fast` / `xhigh` | 固定識別子は使用せず、実行環境で利用できる設定を選ぶ。指定できなければ親のモデルを継承する。役割設定用JSONは作らない |
| `run_in_background`、`readonly`、`environment: cloud`、`resume` | 実際に利用できる機能へ対応付ける。未対応のフィールドをツールへ渡さない。隔離が必要なら実際のworktreeを使用するか、制約を報告する |
| CursorのToDoツール | 実行環境のタスク管理機能を使う。なければPlaybookの全工程と進捗をMarkdownのToDoとして明示する |
| Cursor組み込み`create-skill`、Cursor Team Kitの`/deslop`、`control-ui`、`control-cli` | 導入済みの同等機能が実際に存在する場合だけ使用する。なければ未対応を明示し、必要な検証条件は残す |
| 専門Skill（`how`、`architect`、`arena`、`swarm`、`interrogate`など） | 導入済みの`SKILL.md`があれば読む。なければ依存先が不足していると伝え、呼び出しや完了を捏造しない |
| Git、PR、Automations、Bugbot、外部サービス | 対応している操作であっても、ユーザーが明示的に許可した範囲でのみ実行する。利用できない機能やCursor専用機能は未対応として報告する |

必須の動作検証やUI検証は、元のツールがないという理由だけでは合格にできない。同じ観測対象を検証できる代替手段を用いるか、未検証として報告する。

## 原文の保持

`playbooks/*.md`は原文の工程・見出し・下位項目をすべて維持する。原文のモデル識別子は`<role-model>`に置換してよい。これはモデル選択の置き換えであって、工程を省略する許可ではない。固定した原文は移植履歴で示す。


現在の実行規則は個々の文書へ直接記述する。作業時にこの履歴を読ませる構成は使わない。

# pstackの参照元と変更点

このディレクトリは、pstackを基に改変した配布物である。

- 参照元：https://github.com/cursor/plugins/tree/005d8f6e8ec057b738adcd08a08b30db0478402d/pstack
- 参照元コミット：`005d8f6e8ec057b738adcd08a08b30db0478402d`（固定。更新される`main`を参照しない）
- 原文のライセンス：MIT、Copyright (c) 2026 Lauren Tan。法的な原文は`LICENSE.pstack`に保持する。
- 原文ファイル：`skills/poteto-mode/SKILL.md`、`skills/poteto-mode/worker.md`、`skills/poteto-mode/playbooks/*.md`の22本、`skills/principle-*/SKILL.md`の24本。

## 明示的な変更内容

1. 入口Skillを`poteto-mode`から`saji`へ変更。原文のNon-negotiablesの発動条件を入口に維持し、Principles、Autonomy、Subagents、Writing the reply、Playbooksを個別の参照ファイルへ分離した。
2. 原文のGuideにある「複数工程ではPrincipleの全一覧を最初に確認し、Playbookの全工程をToDoへ展開する」動作を追加。見出しと入れ子のチェック項目を短縮しない。
3. Cursor固有の`poteto-agent`、モデル識別子、`Task`引数、設定ファイルの前提を、`references/delegation.md`と`references/compatibility.md`で実行環境の能力に置き換えた。役割設定用のJSONは作らない。
4. 自律実行規則と`worker.md`の権限を厳格化した。コミット・Push・PR操作にはユーザーの許可が必要。原文にある自律的なコミットや出荷の指示に優先する。
5. 22本のPlaybookの工程と下位項目を保持して移植した。固定モデル識別子は`<role-model>`へ置換し、選択方法は`references/delegation.md`で扱う。
6. 24個のPrincipleの本文全体を`principles/*.md`へ収録し、Cursor専用のfrontmatterを除去した。適用条件は`references/principles.md`で管理する。
7. `architect`、`swarm`、`arena`、`how`、`interrogate`などの専門Skillや外部`cursor-team-kit`の実装は、**ここには同梱していない**。導入・移植されるまでは、関連工程は未解決の依存条件であり、実行済みとは扱わない。
8. 原文の自然言語を日本語化した。Skill名、ファイルパス、コマンド、固定の機械的識別子は保持する。原文の工程・判定条件・制約を省略しない。

pstack由来の文書が存在することを、製品のビルド成功や実行時テストの合格と混同しない。

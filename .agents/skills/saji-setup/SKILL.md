---
name: saji-setup
description: sajiで使うサブエージェント定義を、Pi・Codex向けに生成する初期設定Skill。既存の定義は変更しない。
disable-model-invocation: true
---

# saji-setup

Pi・Codex向けのAgent定義を生成する。定義本文は`agents/`にあり、生成処理は`scripts/generate.mjs`が行う。各Agentへ渡すタスク固有のプロンプトは、実行するPlaybookが作成する。

1. 対象Workspaceと、Pi・Codexのどちらへ生成するかを確認する。
2. 次のコマンドで生成予定を確認し、**作成の承認**を得る。
3. 承認された範囲だけ生成し、作成・スキップしたファイルを確認する。

```sh
node .agents/skills/saji-setup/scripts/generate.mjs --workspace . --target both --dry-run
node .agents/skills/saji-setup/scripts/generate.mjs --workspace . --target both
```

`--target`は`pi`・`codex`・`both`。生成先は`.pi/agents/`と`.codex/agents/`。既存ファイルは**上書きしない**。モデルと推論レベルは定義に固定しない。既存の設定が優先される場合はその設定に従う。

| 生成するAgent | 役割 |
| --- | --- |
| `saji-worker` | 共通の委譲担当 |
| `arena-runner` | 候補作成 |
| `arena-judge` | 候補の評価 |
| `swarm-worker` | 分担作業 |
| `interrogate-reviewer` | 実証付きレビュー |
| `comment-sicko` | コメントレビュー |

`arena-runner`がなければ親継承で起動する。実際の呼び出しには、生成済みの`saji-worker`を使う。

このSkillはサブエージェントの**定義だけ**を生成する。Docker、worktree、使い捨てWorkspaceの提供や書き込み隔離は行わない。安全な候補別実行環境が必要なPlaybookは、引き続き`saji/unresole/`で実行停止とする。

```sh
node --test .agents/skills/saji-setup/tests/generate.test.mjs
```

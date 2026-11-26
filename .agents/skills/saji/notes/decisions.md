# sajiの棚卸し・採用判断

これは設計作業用の記録。**実行時のSkillから参照しない**。原則本文や翻訳の代替ではない。

## 出発点

- 新ブランチ：`feature/saji-native`（`v2`から分岐）
- 原文和訳の凍結版：`feature/saji-skill` / [PR #7](https://github.com/YayanmaBanban/VSCode-Codex-Nerita/pull/7)、スナップショット `0727f28a782453b72b119c806b3ad202e1d1d030`
- pstack移植元コミット：`005d8f6e8ec057b738adcd08a08b30db0478402d`

## 確定した判断

- pstack由来の**24個のPrincipleをすべて採用**する。必要な適用条件で選び、本文を読む。
- **Guard the Context Window と Never Block on the Human は訳文の本文を変更しない。** Pi/Codexの運用・権限の決定を原則へ追記しない。
- `typescript-best-practices` と `benchmark-checklist` の**専門Skillは現段階で導入しない**。Type System DisciplineとExplain the NumberのPrincipleそのものは採用する。
- `unresole/`の4件から原則本文を取り出す際には、翻訳の一部でない実行禁止の警告だけを除いた。
- 24件の日本語本文に**新しい規則や注記は追加しない**。
- Worktree、使い捨てSandbox、サブエージェント起動方法などは今後のPlaybook・実行環境の棚卸しで判断する。Principleへ解決策を埋め込まない。

### Principle本文から削除した文言

専門Skillを導入しない判断に伴う、新ブランチでの意図的な2箇所の差分。削除した文言は凍結版の日本語訳をそのまま記載する。

| ファイル名 | 削除した文言 | 理由 |
| --- | --- | --- |
| [`type-system-discipline.md`](../principles/architecture/type-system-discipline.md) | TypeScriptの具体的な構文は**typescript-best-practices** Skillを参照する。 | `typescript-best-practices` は現段階で導入しないため。Type System Disciplineは採用する。 |
| [`explain-the-number.md`](../principles/verification/explain-the-number.md) | 性能の数値には**benchmark-checklist** Skill（原文：`../benchmark-checklist/SKILL.md`）を実行する。 | `benchmark-checklist` は現段階で導入しないため。Explain the Numberは採用する。 |

## この段階で未実装のもの

Playbook、Arenaなどの専門Skill、`saji-setup`の統合、実行環境との接続は未着手。凍結版に存在しても新ブランチへ自動的に移植しない。

## 再検討する場合

判断内容を更新する場合も、まずこの新ブランチで検討し、凍結した和訳PR #7の本文を編集しない。

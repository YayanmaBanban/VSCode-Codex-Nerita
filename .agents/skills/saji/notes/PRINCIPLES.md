# sajiのPrinciple採用判断

2026-11-25に合意した方針。これは作業履歴であり、実行時に読む規則ではない。実行規則の正本は`../principles/`と`../references/autonomy.md`にある。

## 採用範囲

- pstack由来のPrinciple **24件すべてを採用**。重要そうなものだけを恣意的に選別・省略しない。
- 毎回24本文をすべて読むのではなく、適用条件の一覧を確認し、該当するPrincipleの本文を読む。
- Principleの「判断基準」と、Cursor/Pi/Codex固有の「実行手段」を分離する。実行方式の違いを個々の原則に増殖させない。

## 原文からの明示的な調整

| 原則 | 変更の理由と範囲 |
| --- | --- |
| Guard the Context Window | 親のコンテキストを節約し、調査を分担し、要点を残すという目的は保持。モデル名・起動API・作業の隔離方式は原則では固定せず、実際の実行環境が管理する |
| Never Block on the Human | 依頼された範囲の元に戻せる作業は都度確認せず進める。一方、コミット・Push・PR作成・マージなどは明示的な許可が必要であり、原則自体に権限を付与しない。承認境界の正本は`../references/autonomy.md` |
| Type System Discipline | 型を用いて不正状態を防ぐ本文は採用。原文の`typescript-best-practices`参照は今は導入しないため、専門Skillへの依存を外す |
| Explain the Number | 計測を検証する4条件と評価結果の確認は採用。原文にある性能計測時の`benchmark-checklist`必須起動は、専門Skillの導入を後回しにする判断により、今回は採用しない |

## 今回対象外とする専門Skill

- `typescript-best-practices`：専用のTypeScript規則の追加と自動適用は保留。
- `benchmark-checklist`：個別の性能計測チェックリストの実装は保留。

両Skillの原文の日本語訳は`../unresole/skills/`に残す。**保留はPrincipleの不採用を意味しない。** ただしExplain the Numberの原文にある専門Skill必須条件を外したことは、原文との意図的な差分である。

## 再開時の注意

新しいsajiを設計するときは、この判断を出発点とし、24件を改めて重要度で選別しない。Worktreeなど実行環境固有の手段をPrincipleの要件と混同しない。専門Skillを採用するかどうかは、後続のPlaybookで必要になった時点で判断する。

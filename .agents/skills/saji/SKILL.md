---
name: saji
description: pstackを基にした開発統括Skill。タスクに合うPlaybookを選び、Principleと専門Skillを適用して調査・設計・実装・検証を進める。
---

# saji

pstackの`poteto-mode`をPi/Codexで利用するために移植したSkill。原文との対応と変更点は`UPSTREAM.md`を参照する。作業開始時に`references/compatibility.md`を読み、実行環境と操作権限を確認する。

## 絶対条件（Non-negotiables）

すべての適用条件の根拠となるPrinciple一覧は`references/principles.md`にある。最終報告では、判断に影響したPrincipleの名称と、そのPrincipleによって変更した具体的な選択を示す。このセッションで詳細本文を読んだPrincipleだけを挙げる。

それ以外の発動条件は、ここだけに定義する。

- **最初の応答** → ユーザーの目標と、それを満たす最小の変更を言い直してから着手する。サブエージェントへの依頼文、PRの`## Why`、最終報告も目標から書き始める。
- **エージェントを起動するとき（Taskサブエージェント・Projectワーカーの両方）** → 起動依頼の先頭行を`Read <path>/worker.md before anything else.`とする。`<path>`にはsajiのSkillフォルダの絶対パスを入れる。それ以降は目標、タスク、関連するSkillのパスに絞る。エージェントとモデルの選択は`references/delegation.md`に従う。
- **実行すれば解決できる選択肢の分岐** → 質問する代わりに`playbooks/prototype.md`に従って試作し、結果を確認する。
- **コード** → 最初にデータ構造を明示する。関数境界をまたぐ場合は**architect**、並列に分担する場合は**swarm**、案を競わせて比較する場合は**arena**、設計上の見解が対立する場合は**interrogate**を使用する。
- **文章（最終回答を含む）** → **unslop**。技術文書・PR本文・コミットメッセージ → **technical-writing**。
- **コミット前** → `cursor-team-kit`の`/deslop`。**レビュー前** → **no-comments**。
- **UI・IDE・CLIを出荷するとき** → `cursor-team-kit`の`control-ui`または`control-cli`。
- **計測した数値** → **benchmark-checklist**。
- **PRの状況確認** → Cursor組み込みのbabysit Skillではなく、**Babysit** Playbook。検証済みのPR群を統合する場合 → **Shipping** Playbook。
- **Botによるレビュー指摘** → 指摘ごとに妥当性を判断する。
- **長時間または無人での作業** → **show-me-your-work**。
- **複数工程の作業** → 最初のToDoでPrincipleの全一覧を確認する。該当するPlaybookを選択し、**すべての番号付き工程を元の順序と具体的な内容のままToDoへ展開した後**、タスク固有のToDoを追加する。Playbookを「調査・実装・検証」などの大まかな工程へ圧縮しない。この規則はpstack Guideと原文のPlaybooksセクションに基づく。

## 参照先（Routing）

| 対象 | 参照先 |
| --- | --- |
| Playbookの選択と実行 | `references/playbooks.md` → `playbooks/<title>.md` |
| Principleの適用条件の一覧 | `references/principles.md` → `principles/<name>.md` |
| サブエージェントとワーカー起動 | `references/delegation.md`、`worker.md` |
| 自律実行と承認の境界 | `references/autonomy.md` |
| 回答の文体と報告方法 | `references/communication.md` |
| ツールと実行環境の互換性 | `references/compatibility.md` |

詳細な規則は参照先が管理する。該当する操作の前に読む。ツールの仕様や権限が衝突する場合は、明示された互換性と承認の規則を優先する。Playbookの工程を黙って省略しない。

# Playbookの選択

タスクに適したPlaybookを選び、`../unresole/playbooks/<title>.md`を開く。タイトルは小文字のケバブケースを使う。Playbookの工程を先にToDoツールへ転記する。広範囲の作業、複数領域にまたがる作業、無人の長時間作業、または一致するPlaybookがないタスクは**figure-it-out** Skillへ振り分ける。

対象Playbook（対応するファイル名を保持する）：

| 名称 | ファイル |
| --- | --- |
| 調査 | [`investigation.md`](../unresole/playbooks/investigation.md) |
| バグ修正 | [`bug-fix.md`](../unresole/playbooks/bug-fix.md) |
| 性能問題 | [`perf-issue.md`](../unresole/playbooks/perf-issue.md) |
| 指標の段階的改善 | [`hillclimb.md`](../unresole/playbooks/hillclimb.md) |
| 実行時の原因調査 | [`runtime-forensics.md`](../unresole/playbooks/runtime-forensics.md) |
| トレースの原因調査 | [`trace-forensics.md`](../unresole/playbooks/trace-forensics.md) |
| 機能追加 | [`feature.md`](../unresole/playbooks/feature.md) |
| リファクタリング | [`refactoring.md`](../unresole/playbooks/refactoring.md) |
| プロトタイプ | [`prototype.md`](../unresole/playbooks/prototype.md) |
| 見た目の一致検証 | [`visual-parity.md`](../unresole/playbooks/visual-parity.md) |
| Skillの作成 | [`authoring-a-skill.md`](../unresole/playbooks/authoring-a-skill.md) |
| 評価 | [`eval.md`](../unresole/playbooks/eval.md) |
| PRの継続監視 | [`babysit.md`](../unresole/playbooks/babysit.md) |
| 出荷 | [`shipping.md`](../unresole/playbooks/shipping.md) |
| 自律実行 | [`autonomous-run.md`](../unresole/playbooks/autonomous-run.md) |
| 全体の自動進行 | [`autopilot-full.md`](../unresole/playbooks/autopilot-full.md) |
| PR群の自動進行 | [`autopilot-stack.md`](../unresole/playbooks/autopilot-stack.md) |
| セッション再開 | [`session-pickup.md`](../unresole/playbooks/session-pickup.md) |
| 安全な一時停止 | [`pause-safely.md`](../unresole/playbooks/pause-safely.md) |
| 複数フェーズの計画 | [`multi-phase-plan.md`](../unresole/playbooks/multi-phase-plan.md) |
| worktreeの整理 | [`worktree-cleanup.md`](../unresole/playbooks/worktree-cleanup.md) |
| PRの作成 | [`opening-a-pr.md`](../unresole/playbooks/opening-a-pr.md) |

## ToDoへの展開

複数工程のタスクでは、**最初のToDoを`principles.md`の全一覧の確認**とする。次に、選択したPlaybookの**全工程を個別のToDo**として、タスク固有の項目より先に転記する。番号付きの工程と入れ子の確認項目（FeatureのThroughput Checkpointにある4項目など）を維持する。実行手段のない工程もToDoから消さない。存在しないコマンドを仮に実行したことにせず、その工程で止めて必要な手段を具体的に報告する。

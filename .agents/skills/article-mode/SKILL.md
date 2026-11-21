---
name: article-mode
description: 日本語の技術解説・技術比較・チュートリアル記事を執筆またはレビューする。読者と記事の目的から工程を選び、出典、構成、読みやすさ、図解、媒体別表示を検証する。新規記事では構成案の比較とユーザー承認を経てから執筆する。
---

# 技術記事の執筆・レビュー

技術記事の執筆、構成提案、既存記事のレビュー、媒体向けの変換に使う。通常のコード実装、リポジトリ文書の一般的な編集、文章だけの校正には適用しない。既存稿のレビューや変換では依頼された工程から始める。新規記事や構成の全面的な作り直しには、初稿前の構成承認が必要。

## 入口

記事のテーマ、読者と前提知識、読者が得たい答え・判断・結果、必須事項、既存資料、媒体、分量の希望を把握する。依頼から推定した条件は明示し、結論や対象範囲を左右する不明点だけ確認する。媒体未指定なら標準 Markdown を使う。

| 読者が主に求めるもの | 選ぶ工程 |
| --- | --- |
| 技術の仕組みや適用条件を理解したい | [技術解説](playbooks/technical-explainer.md) |
| 条件に合う選択肢を決めたい | [技術比較](playbooks/comparison.md) |
| 操作を実行して結果を再現したい | [チュートリアル](playbooks/tutorial.md) |

依頼の主目的で一つ選び、補助的な比較や操作例はその中に置く。[Principles](references/principles.md) と選んだ Playbook を読み、以下の参照先は該当工程で開く。

1. [調査・出典確認](references/evidence.md) の手順で資料を集め、主張と根拠を対応付ける。
2. 新規記事や構成の全面改稿では [Article Outline Arena](references/outline-arena.md) で構成3案と独立レビューを提示する。明示的な承認を受け、章・主張・根拠を持つ `approvedOutline` を保存する。構成提案までの依頼では構成で止める。
3. Arena の執筆前検査を通った `brief` と `approvedOutline` から初稿を1本作る。[Outline Fidelity Review](references/outline-fidelity.md) で構成と根拠を照合し、重大な指摘を解消してから [日本語校正](references/proofreading.md) と [Scanning Review](references/scanning-review.md) に進む。
4. [Reading Experience Review](references/reading-experience.md) で読む負担が高い箇所を調べ、[語り口と情報の順序](references/editorial-voice.md)を初稿と改稿で確認する。[Visual Structure Review](references/visual-structure.md) で必要な関係だけを図解する。
5. 重要な主張と条件を本文に置き、補足だけを対象媒体で初期閉状態にする。[Zenn](references/platforms/zenn.md)・[Qiita](references/platforms/qiita.md) は指定された媒体分だけ適用する。
6. 改稿を同じ `approvedOutline` と再照合する。[結び](references/final-takeaway.md) と [媒体での折り畳み](references/folded-details.md) も確認する。実装・出典との一致、手順の再現、リンク・表示を確認し、記事 Markdown、使用した SVG の編集元、主張の根拠、検証結果と未確認事項を渡す。途中稿や候補は、承認の決定記録や評価用の差分など、再利用するものに絞る。

この手順から記事の公開や外部への画像アップロードを開始しない。通常の実装・CI に校正やプレビューを追加しない。スキルの評価に使う記事への指摘は、修正前に [検証ガイド](references/evaluation.md#フィードバックからスキルを見直す) に沿って、記事固有の修正か、Principle やレビュー手順に反映できるかを判断する。

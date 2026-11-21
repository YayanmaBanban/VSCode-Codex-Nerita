# Outline Fidelity Review

初稿直後と、校正などで内容や章順を調整したあとに、同じ承認済みの `brief` と `approvedOutline` に戻る。見出しの語句、文体、分量の変更は、その章の主張と例の役割を保てば許容する。ユーザーが承認した変更は `explicitScopeChanges` を優先して照合する。

| 検査軸 | 原稿で照合すること |
| --- | --- |
| 制作動機 | `authorMotivation` が、読者にとって記事を読む理由として伝わるか |
| 主張 | `coreThesis`、`mustPreserve`、`mandatoryTopics`、各章の `claim` を残したか |
| 実例・図 | 冒頭の比較、説明の直後の図など、確定構成で承認した位置と役割を保ったか |
| 根拠 | 導入・Brief の主張は `brief.evidence`、各章は `evidenceIds` から出典と該当箇所を開く。確認事実、作例、未確認事項の範囲が本文と対応するか |
| 開示 | 結論、重要条件や注意事項が折り畳みの外から読めるか |
| 採用範囲 | 承認された候補から取り込む要素を保ち、未採用案の追加で主題や必須事項が変わっていないか |
| 題名の約束 | [Title Promise](title-promise.md) に沿って、題名が約束する価値と本文が実際に届ける内容・根拠を照合する |
| 語り口と順序 | [語り口と情報の順序](editorial-voice.md)に沿って、導入だけで理解できる内容、読者が自然に知りたくなる疑問、詳細を使う位置を初稿・改稿で照合する |
| Skill の価値 | [Brief の記事種別と読者の期待](editorial-brief.md)に戻る。Skill紹介では、エージェントに渡す依頼、静的検査後の判断、修正・再検査がつながっているか確認する。CLI しかなければ `skill-value-missing` を使う |
| 章の役割と接続 | [章の役割とつながり](section-roles.md)を承認構成と照合する。内容を移した箇所は、元の章の答え、次の章への理由、役割の重複を続けて読む |
| 具体例と出典 | [具体例の根拠](example-evidence.md)と[参考元の配置](source-attribution.md)を初稿と改稿で照合する。変更前後の意味、根拠となる箇所、確認の範囲、実際に出典を開ける位置を記す |
| 制作物と例の役割 | 制作物が承認済みの主題なら、題名・導入・本文の目的をそろえる。具体例の直後は、[この例で変えたこととその理由](reading-experience.md#具体例の直後を読む)が追えるか確かめる |

初稿と改稿の最後は [Final Takeaway Review](final-takeaway.md) で確認する。変換後の補足は [折り畳みの表示照合](folded-details.md) に渡す。

数値や動作は [事実・出典の確認](evidence.md#主張を照合する) を併用する。たとえば `retries < 2` は呼び出し時点の分岐条件を示す。最大回数を述べるときは初期値、加算のタイミング、呼び出し側が回数を引き継ぐ範囲を確認する。確認できた範囲が分岐だけなら、作例の前提を本文に明記する。実測結果、検証用コード、説明用の UI はそれぞれの範囲を記録する。

## 結果の記録

`fidelityReview` に実際に読んだ `draftRevision`、`outlineRevision`、`status`、`issues`、取得できる `reviewedAt` を保存する。実行前は `pending`、重大な逸脱や未検証の断定が残る場合は `needs_revision`、解消後は `passed` とする。

指摘は `id`、`severity`（`blocking` / `major` / `minor`）、`outlineRef`、`draftRef`、`expected`、`observed`、`suggestedAction`、`evidenceIds` を持つ。表現だけで直せるずれは既存の承認の範囲内で修正する。重要な主張や条件の欠落、主題の無断変更、未確認事項の断定は重大な指摘として扱う。承認対象そのものの追加・削除・変更が必要なら、ユーザーの判断へ差し戻す。

修正後は原稿の新しい版と根拠を読み、指摘ごとに `resolution` を `resolved` または `unresolved` とする。解消した指摘は `resolutionEvidence` に修正文や実行結果を残す。字面の一致や数値スコアで完了を決めず、読者が同じ主張と条件を読み取れるかを確認する。

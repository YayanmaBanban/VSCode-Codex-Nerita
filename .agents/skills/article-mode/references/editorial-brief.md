# 制作動機と読者に届ける価値

ユーザーが提示した資料と調査で見つけた資料は、[参考元と根拠リンク](source-attribution.md)の手順で制作への影響、主張の根拠、補足の役割を確かめる。

構成を作る前に、`topic`、`coreThesis`、`mandatoryTopics` から記事の中心を決める。Skill紹介では、読者がそのSkillへ何を頼めて、どんな判断を返してもらえるかを示す。検証記事では、条件をそろえて何を試し、何が分かったかを軸にする。チュートリアルでは、読者が手元で到達できる結果と手順を示す。Arena と初稿・改稿のレビューで、これらが題名の約束と一致するかを読む。制作を掲げる題名なら、制作動機と実際の工夫を本文で届ける。

## 制作動機の根拠

| `motivationEvidence.kind` | 記事で使える範囲 |
| --- | --- |
| `user-statement` | ユーザーが明示した理由。以前の発言も出典をたどれるなら、その発言が裏付ける範囲で使う。 |
| `documented` | 過去の記事や仕様に記録された理由。記録された説明として扱う。 |
| `editorial-example` | 読者の場面を説明する例。筆者の体験談として語らない。 |
| `unconfirmed` | 出典をたどれない情報。一般的な課題として説明できる範囲にとどめる。 |

`authorMotivation` に使う説明を書き、区分が伝わりにくい場合は `motivationEvidence` を添える。本人発言・既存文書には `sourceRef`、各区分には `note` で裏付けられる範囲を記す。期間、回数、感情、改善効果などは、それぞれ出典がある場合だけ使う。

## Skill の使い方を構成に入れる

Skill紹介では最初の具体例に入るまでに、静的検査が集める候補と、Skill が周辺コードを読んで判断することを短く説明する。使い方の冒頭に現行のSkill名、対象、依頼したい確認を含む最短のエージェント依頼例を置く。何を渡すと、候補の検査、意味の確認、修正、同じ範囲の再検査がどう進み、人がどこを確認できるかを示す。CLI 例を載せる場合は、静的検査とレビュー用データを取得する操作として説明する。未実行の依頼例は、読者が試す文面として示す。

例えば `$japanese-proofreading` なら `src/retry.ts` のコメントを指定し、条件と回数を周辺コードで確かめ、修正後に同じファイルを再検査するよう頼む。検証記事にこの例を入れるかどうかは題名と読者への約束で決める。

意図を別項目にする場合は `articleIntent.kind`（`skill-introduction`、`development-record`、`verification`、`tutorial`）と `readerValue` を保存する。Skill紹介には `skillValue` と `agentRequest` を含める。題名や主題を変える提案は Title Promise と構成の承認へ戻す。

制作物と具体例がどちらも題名に使えそうなら、`articleIntent` に筆者と制作物の関係（`artifactRole` の `created`、`adopted`、`reviewed`）、`artifactName`、`artifactValue`、記事の主題（`articlePrimarySubject`）、説明に用いる題材（`exampleTopics`）を必要に応じて記録する。確認できた情報を使い、関係・名称・価値・主題が未確認なら該当項目を省くか `null` にする。

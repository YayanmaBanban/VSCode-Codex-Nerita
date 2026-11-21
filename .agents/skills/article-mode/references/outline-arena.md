# Article Outline Arena

承認の対象は構成一つ。比較するのは記事の入り方と説明順であり、技術的事実と必須の説明は全案で共有する。

1. **Editorial Brief を確定する。** テーマ、種別、読者と前提知識、媒体、根拠、必須事項、制約、分量、ユーザーの希望をまとめる。[制作動機と読者に届ける価値](editorial-brief.md)を明確にし、3案と独立レビューに同じ版を渡す。
2. **独立した構成3案を集める。** 同じ Brief と出典を三つの担当に渡し、意図する編集方針だけを変える。例えば疑問から始める、具体例から始める、責務の境界から始める。各担当は別のコンテキストで作業し、他案の下書きを読まない。並列実行ができなければ独立セッションを順次使い、使えた隔離の範囲を記録する。
3. **各案の要素と違いを確認する。** タイトル、対象読者、一文要約、短い導入、見出しと各章の主張、実例、SVG の配置案、折り畳む詳細、推す理由と懸念をそろえる。読者に届ける価値、導入順、最も強い実例の位置と役割を比較し、差が実質ある理由を記録する。該当案を戻しても差が出なければ未達を伝え、承認待ちに進まない。
4. **新しい読み取り専用の担当に匿名案を比較してもらう。** 生成に関わっていない別コンテキストを使う。可能なら生成担当と異なるモデル系統を使う。Brief・出典・案 A/B/C の本文と評価軸を渡し、作成者、モデル名、候補生成者の推す理由は伏せる。レビュー担当は、①読者目的、②見出しから読み取れる主張、③流れと認知負荷、④実例・図の役割、⑤事実と出典の整合と、下記の4つの問いについて、強み・弱み・不足条件・適した読者を理由付きで報告する。推薦や他案から借りる要素を示してよい。差が小さければ同等とし、複数のレビューで見解が割れた場合は根拠と条件を併記する。
5. **比較ページを渡し、チャットでの選択を待つ。** [比較ページの保存手順](#比較ページを保存する) に従い、3案とそれぞれの独立レビューを並べて表示する。チャットには比較ページへのリンクを出す。レビュー担当の推薦を表示した場合は、ユーザーの「推奨」を採用の意思表示として受け取る。A/B/C、部分統合、条件を変えた再提案、差し戻しも受け付ける。執筆にはユーザーの明示的な承認が必要。差し戻しでは変更された範囲に戻る。統合条件が曖昧なら統合後の構成を提示して確認する。
6. **採用した構成を確定して渡す。** ユーザーの原文、採用元、取り込む要素、承認された変更を記録する。統合案も章順・主張・根拠・図・折り畳む内容を `approvedOutline` に確定する。執筆前検査を通った `brief` と `approvedOutline` だけを出典とともに執筆担当へ渡す。初稿の後は [Outline Fidelity Review](outline-fidelity.md) に進む。

独立コンテキストを確保できない場合は、できるところまで構成準備を行い、独立審査の未実施を明示する。同じ担当による自己評価を独立審査として扱わず、必要な候補と比較がそろうまでゲートを未完了とする。初回は3案とレビュー1回を基本とし、再提案はユーザーの依頼または候補品質の不足に限る。

## 続きを読みたくなる構成かを確かめる

題名だけの回答を受け取った後、[語り口と情報の順序](editorial-voice.md#構成を選ぶ前に)に沿い、題名と最初の段落、導入の残り、構成全体の順に渡す。最初の問いは最初の段落で答え、導入だけから伝わった内容を別に残す。構成全体を読んでから残りの問いに答える。

1. 「冒頭だけを読んで、その続きを読みたいと思えるか？」
2. 「この記事でしか得られない発見や実体験は何か？」
3. 「最も興味を引く具体例が、説明の後ろに埋もれていないか？」
4. 「文章としての完成度を優先しすぎて、筆者が困った経緯や試行錯誤を消していないか？」

判断の根拠になった導入の文、具体例、配置、経緯を示す。実例を理解するための情報は、読者が必要とする位置に置く。筆者本人の経験、今回確認できた作例、推測を区別する。根拠のある発見や経緯が不足している場合は、何を確認すると記事にできるかを示す。

題名の約束と記事種別を照合し、Skill紹介では、読者がエージェントに頼める内容と、静的検査のあとに得られる判断が見えるか確認する。検証記事は確認した入力・コード・結果を中心に評価する。

[章の役割とつながり](section-roles.md)を比較し、部分統合後も読者が必要とする説明がどこに残ったかを確認する。承認した要素と見送った役割は、採用理由や提案と一緒に残す。

独立審査では[具体例の根拠](example-evidence.md)を重要な章ごとに比べ、[参考元と根拠リンク](source-attribution.md)の置き方と導入の流れも読む。比較ページの具体例・構成の注意点に、例で言える範囲、確認できる出典、採用したい配置の理由を記す。

制作物の紹介では[制作物と具体例のどちらが主題か](title-promise.md#制作物と具体例のどちらが主題か)を確認する。題名単独で期待した内容と、本文を読んだ後の判断を既存の審査記録に残す。

## 比較ページを保存する

比較ごとに作業領域内のディレクトリを用意し、構成案と独立レビューを `arena.json` に保存する。構成案は見出しと各節の要点まで JSON に入れる。`recommendation` にはレビュー担当が推薦した組み合わせと使う要素を記録し、ユーザーが選択した後は `decision` に実際の判断を記録して再生成する。

| JSON の項目 | 保存する内容 |
| --- | --- |
| `title` | 比較の題材 |
| `candidates` | `id` が `A`・`B`・`C` の順に並んだ3案 |
| 各案の `title`、`summary`、`audience`、`opening` | タイトル、一文要約、読者、導入案 |
| 各案の `sections`、`diagrams` | `heading` と `claim` を持つ見出しの配列と、図の配置 |
| 各案の `example`、`foldedDetails`、`tradeoff` | 主な作例、折り畳む内容、構成上の利点や懸念 |
| 各案の `review` | 独立レビューの `opening`（冒頭）、`discovery`（発見）、`example`（具体例の位置）、`process`（試行錯誤）、`caveat`（構成上の注意・根拠との整合） |
| `recommendation`、`decision` | 推薦と選択の記録。推薦がない場合や選択前は該当項目を省略できる |

リポジトリルートから次を実行すると、JSON と同じディレクトリにローカルで開ける `index.html` ができる。[入力 JSON の実例](../tests/fixtures/japanese-proofreading/arena-2/arena.json)

```text
node .agents/skills/article-mode/scripts/render-outline-arena.mjs path/to/arena.json
```

ページに `推奨`（レビュー担当の推薦がある場合）、`A`、`B`、`C`、`条件を変えて再提案` と、チャットで回答する案内を表示する。部分統合を伝える例も添える。ページと JSON は同じディレクトリで共有できる。

## 承認と執筆のデータ契約

`arena.json` は `schemaVersion: 2` で保存する。比較ページの `recommendation` と `decision` は人が読む文字列として維持する。過去の実行は比較ごとのディレクトリに残し、A＋C の選択と別の回の A＋B の選択を混ぜない。

| 項目 | 保存する内容 |
| --- | --- |
| `brief` | `topic`、`reader`、`authorMotivation`、`coreThesis`、`mustPreserve`、`mandatoryTopics`、`constraints`、`evidence`。根拠ごとに `id`、`claim`、`status`（`verified` / `illustrative` / `unverified`）、`sourceRef`、`verificationNote` を持たせる。実行・出典を確認できた根拠を `verified` とする |
| `reviewExecution` | `generatorRuns`（`candidateId`、`runId`）、`judgeRun`（`runId`）、共通入力を識別する `inputRevision`、独立性の `independence`。実行の根拠が確認できない場合は値を `null`、独立性を `unverified` とする。`diversity` は判定 `status`（`distinct` / `insufficient` / `unverified`）と理由 `basis` を持つ |
| `approval` | `status`（`pending` / `approved` / `revision_requested`）、ユーザー原文 `rawResponse`、`baseCandidateId`、`incorporatedFrom`、`scopeChanges`、`approvedOutlineRevision` |
| `approvedOutline` | 承認済みの `revision`、`title`、`opening`、順序付き `sections`、`preservedIntent`、`explicitScopeChanges`。章は `id`、`heading`、`claim`、`evidenceIds`、`sourceCandidateIds`、`diagramPlan`、`foldedDetails` を持つ。承認までは `null` |
| `fidelityReview` | [構成一致レビューの結果](outline-fidelity.md#結果の記録)。初稿前は `pending` で保存する |

承認前に `approval` モードを実行し、案の実質差と独立実行の記録を確かめる。助言や相槌は承認に使わない。自由文で指定した範囲が曖昧なら、統合後の構成を示して確認する。採用内容や必須事項を変える場合は再承認を受け、構成の改訂番号を更新する。

「推奨」の場合は、独立レビューから `reviewExecution.recommendedSelection` に保存した `baseCandidateId`、`incorporatedFrom`、`scopeChanges` と照合する。明示的な A/B/C や統合の選択も原文を残す。確定内容が一意にならない場合は構成を示し、「この構成で進めてください」などの明示的な承認を待つ。

主題や必須事項を変える明示的な指示があるときは、該当する文を句点を除いて `scopeChanges` にそのまま保存し、新しい `approvedOutline.explicitScopeChanges` と対応させる。原文の確認と承認範囲の判断は担当が行う。

```text
node .agents/skills/article-mode/scripts/check-outline-arena.mjs path/to/arena.json approval
node .agents/skills/article-mode/scripts/check-outline-arena.mjs path/to/arena.json draft
```

`draft` は承認された改訂番号、章の根拠 ID と採用元を検査し、執筆に使う Brief と確定構成を出力する。`record` は保存データだけを検査する。実質差や承認の意味は担当が確認し、実際の原文と判断の根拠を保存する。

## 題名と独立審査の証跡

[Title Promise](title-promise.md) に沿って構成と題名を設計する。匿名審査では題名だけの判断を記録してから構成と根拠を開示する。ユーザーには採用構成と題名を一緒に提示する。

新しい実行では、各 Run に成果物への `artifactRef`、`inputRef`、`inputHash`、`outputDigest` を記録する。参照は比較ディレクトリ内の JSON とキー（例 `review-artifacts.json#judgeInput`）。ダイジェストはその値を `JSON.stringify` した UTF-8 の SHA-256 とし、`sha256:` を先頭に付ける。

`contextEvidenceRef` に、担当者が確認した別コンテキストの実行、匿名にした項目、タイトルだけの審査を先に受け取ったこと、入力と出力の対応を記録する。生成と審査の入力に `inputRevision` と同じ `sharedBrief` を入れる。生成出力には `runId`、匿名の `candidate`、比較ページと同じ `headings` を保存する。審査入力には匿名の `titles`・`candidates`、出力には `runId` と `titleOnly` を含む審査結果を保存する。取得できない参照は `null` と理由を記録する。保存例は [匿名審査の入出力](../tests/fixtures/japanese-proofreading/output-review/review-artifacts.json) を参照する。証跡の保存や参照は作業者がアクセスできる範囲とし、実行ログの公開を求めない。

承認前・執筆前の検査は、入出力の照合と、担当者が別コンテキストを確認した記録を要求する。Run ID やハッシュ単体で独立性を判断しない。以前の履歴はその時の記録として残し、`record` モードで現在確認できない証跡を `unverified` と報告する。新規の執筆検査に使うときは、新しい実行で証跡を取る。

新しい審査では、審査入力の `openings` に比較案と同じ `id`・`title`・`opening` を入れる。審査出力で、案 ID ごとに `firstParagraph` の `curiosity`・`observed` と、`openingOnly` の `problem`・`attempt`・`readerValue` を保存する。実行を確認した記録の `reviewStages` に、回答を受け取った順で `title-only`、`first-paragraph`、`introduction`、`full-outline` を保存する。

`candidates[].review.openingAssessment` に各案の `openingOnly` の回答、`review.issues` に該当する編集上の指摘を保存する。指摘がなければ空配列にする。比較ページの「冒頭の引き」と「構成の注意点」には、判断の理由と読者がつまずく箇所を記載する。既に保存された実行に導入だけの審査を後から足さない。

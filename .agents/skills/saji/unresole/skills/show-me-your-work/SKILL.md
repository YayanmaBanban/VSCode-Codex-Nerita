> **未解決のため実行できません。** このSkillには使用するツール・配置先・権限について未決事項があります。実行せず、ユーザーへ未決事項を伝えて停止してください。以下は原文に沿った日本語訳です。

---
name: show-me-your-work
description: 長時間・無人作業のレビュー可能な意思決定記録を残す。各判断について内容・理由・証拠・結果を1行とするTSV。既定ではローカルだけに置き、レビュー担当が信頼の根拠として必要とする場合にコミットする。/show-me-your-work、自律・複数フェーズ実行、離席後に人間がレビューする仕事で使用する。
disable-model-invocation: true
---

# 作業を見せる（Show me your work）

記録の正本を1つだけ維持する。

## 形式

1つのTSVファイルで、判断1件につき1行とする。セル内の改行は禁止。証拠は文章ではなく参照先を記す。

最初に`references/decision-log-template.tsv`（見出し行）をコピーして空のログを作る。列は以下のとおり。

- **ts。** ISO8601形式のタイムスタンプ。
- **phase。** フェーズまたは作業系列。
- **decision。** 何を選び、何を行ったかを1行で記載。
- **why。** 平易な言葉による理由。Principleが判断の根拠なら、専門用語のラベルではなく意味を説明する。
- **evidence。** 証明するリンクかパス。コミットSHA、PR番号、`file:line`、成果物、トレース、スクリーンショットのパスなど。長い文章は書かない。
- **result。** 結果または完了条件の状態。`tests green`、`reverted`、`pixel-diff 0`、`INCONCLUSIVE`、`open`など。

レビュー担当が一目で読めるよう平易な言葉で書いた例。

```
ts	phase	decision	why	evidence	result
2026-05-24T09:02:00Z	frame	counted the work first, about 100 components and roughly 75 hours	wanted to know the size before starting a long run	commit 3a9f1c2	found 5 things to sort out before starting
2026-05-24T09:40:00Z	harness	took screenshots of the old version before changing anything	so we can compare old against new and catch any visual change	scripts/snapshot.sh, baseline/	saved 120 reference screenshots
2026-05-24T11:15:00Z	widget	moved the widget styles over without changing how it looks	keep the change small and the result identical	commit 7c21e0a, pixel-diff 0	looks identical, tests pass
2026-05-24T12:30:00Z	widget	threw out a helper's work because its screenshots were blank	checked the real files instead of trusting its summary	worktree reset	reverted, tightened the instructions for next time
```

## 行の記録

同僚へ作業内容を伝えるように記録する。平易な言葉、具体的な操作を使い、AI特有の文章や抽象的な専門用語を避ける。ログの文章にも**unslop** Skillを適用する。

補助スクリプト`scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>`を使用する。タイムスタンプ`ts`を付け、初回には見出し行を書き、不要なタブ・改行を除去し、セルが`=`、`+`、`-`、`@`で始まる場合は先頭にシングルクォートを付ける。`printf`で直接追記してもよいが、生成された文字列やユーザー入力をセルにする場合は、同じ文字の扱いに注意する。

記録するのはすべての操作ではなく、判断とチェックポイントである。選んだ分岐、検証結果付きで完了した作業単位、方針変更・取り消しとその理由、阻害要因の発見、検査ゲートの修正などを記録する。反復実行では各反復を1行とする。明白で些細な操作は省く。

一つのrunは、後続ターンとその要約を含む一つのエージェントとの会話を指す。引き継ぎ、代替エージェント、新しいチャットは新しいrunになる。すでに行があるログへ追記する場合、そのrunの最初の行は`phase: start`とする。別のrunの`start`行の後で初めて書く場合も同様である。後続ターンでログへ戻ったrunは、別のrunが記録したかを調べるため最後の行を最初に読む。`start`行には、このrunが書かなかった直前の行の`ts`の範囲を記載し、証拠にはエージェントIDなど、このrunを特定できる情報を入れる。`start`をそれ以外の用途には使わない。

## 保存場所

既定ではログは作業中の成果物であり、コミットしない。作業ディレクトリの`decisions.tsv`、または複数の作業が並行している場合は`.audit/<task-slug>.tsv`に置き、Git管理の対象外にする。

レビュー担当が結果を信頼するために記録を必要とするほど大きな作業の場合だけコミットする。

## 規則

- 追記専用とする。誤った判断は、それを置き換える新しい行で訂正する。過去の行を編集・削除しない。
- 手作業の一度限りの証拠より、コミット済みスクリプトによって作られた証拠を優先する（**encode-lessons-in-structure** Principle）。

## トランスクリプトとの照合

runの終了時、引き渡し前にログが事実を述べていることを確かめる。システムプロンプトに記載された現在のワークスペースの`agent-transcripts/`から、このrunのトランスクリプトを読む。`~/.cursor/projects/*/`を横断検索しない。無関係な私的チャットを読むことになるため。今回のrunが書いた行を、実際に起きたことに照らして調べる。各区間は、そのrunの`start`行（ログを新規作成したrunなら最初の行）から始まり、別のrunの次の`start`行で終わる。

- すべての行が実際の判断または操作に対応していることを確認する。
- 各行の証拠が解決でき、その行の主張を示しているか確認する。
- 作業の方向を変えた分岐、方針転換、破棄した方法が記録にない場合は欠落として追加する。

修正するのは説明文ではなくログ。監査では、架空の行であっても既存行を編集・削除しない。実際の判断や操作に対応しない行、主張や証拠が誤っている行については、実際に起きた内容と解決できる参照先を持つ、前の行を取り消す新しい行を追加する。この監査はrun以外の区間を検査しない。ただし自分のrunにより、ほかの区間の誤りが明らかになった場合は、ほかの誤りと同様に新しい行で訂正する。

## 異なるモデルによる記録のレビュー

引き渡し前に、実作業を行ったものとは**別のベンダーのモデル**でサブエージェントを起動する。自己レビューは代替にならない。サブエージェントは監査ログとrunのトランスクリプトを読み、ユーザーが注意すべき点を指摘する。作業の再実施ではなく、改善の余地やリスクを調べる。推論レベルは**poteto-mode** SkillのSubagentsセクションに従って選ぶ。

- 根拠が弱いか存在しない判断。
- 省略された検証、または実行記録の証拠なしで実施済みだと主張された検証。
- 振り返ると危険だった選択（早すぎる判断、範囲の拡大、症状の隠蔽など）。
- ユーザーが斜め読みしたときに見落としそうな欠落。

記録を作ったrunの回答はすべて「Attention」節で終える。冒頭にレビュー担当モデルだけを1行（`reviewed by <model>`）で示し、その後で各指摘に該当する行・時点を付けて列挙する。`No flags`も有効。モデル名だけを単独の指摘にしない。

## 記録の読み方

先頭から最後まで読み、証拠の参照先を開き、抜き取り確認する。GitHubはコミットしたTSVを表として表示する。端末では`column -s$'\t' -t decisions.tsv`で表示できる。

## 他のSkillからの利用

ほかのSkillは独自の記録形式を作らず、監査ログをここへ振り分ける。名前で参照し、形式の管理をこのSkillに任せる。列の定義を繰り返さない。

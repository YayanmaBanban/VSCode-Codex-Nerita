# 折り畳みの表示を照合する

`foldedDetails` は、承認された各章で初期状態を閉じる補足の一覧。結論、重要な条件、必要な注意事項、具体例の主張は本文に置く。元 Markdown の構造を見た後、Zenn と Qiita の閲覧用 Markdown を実際に変換・描画して確認する。

必要な場合は `approvedOutline.detailPlan` を使う。各項目に `sectionId`、安定した `detailId`、`kind`、`title`、`requiredSummary`（本文で読める要点）、`initiallyCollapsed: true`、`outputRef`（Zenn・Qiita で対応するパネルのタイトル）を記録する。各章の `foldedDetails` と対応し、行の移動や見出しの言い換え後も同じ ID で照合する。

媒体変換用のコピーでは、折り畳む範囲を独立行の `<!-- detail:detailId -->` と `<!-- /detail:detailId -->` で囲む。[対応する変換コード](../scripts/folded-details.mjs)で、Zenn は `:::details`、Qiita は `details/summary` に変換する。Markdown のまま渡すときは、見出しや通常の本文で補足を読めるようにする。

閉じた状態で必要条件と要点が読めるか確認し、開いた後でコードフェンス、複数行 JSONL、Markdown リスト、リンク、タグの例、入れ子を読む。閉じタグが外の文章を巻き込んでいないか、PC とスマホで操作やコードのコピーができるかも確かめる。変換構文、ローカル表示、対象稿の公式プレビューはそれぞれ記録する。

Zenn のローカルレンダラーとスタイルでは、`diff` の行頭の `+` と `-` は表示されるが、範囲選択でコピーすると省かれる。パッチとして符号ごとコピーする必要がある場合は `text` のコードフェンスを使い、貼り付けたテキストを照合する。

意図した初期閉パネルが開いたまま、重要条件が隠れた、または中の構文が壊れた場合は `type: "presentation-mismatch"` を使う。`detailId`、`outputRef`、期待状態、観察結果、修正案を残し、同じ版を再表示して `resolved / unresolved` を記録する。公式プレビューができない場合、その欄は未確認にする。

媒体別の Markdown を出すときは、変換用のコピーと承認構成を指定する。出力を媒体アダプターの図などの変換に渡す。

```text
node .agents/skills/article-mode/scripts/render-folded-details.mjs path/to/arena.json path/to/article.md zenn
node .agents/skills/article-mode/scripts/render-folded-details.mjs path/to/arena.json path/to/article.md qiita
```

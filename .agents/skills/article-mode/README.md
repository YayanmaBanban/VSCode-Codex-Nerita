# 技術記事の執筆・レビュー Skill

リポジトリを開いたエージェントに `$article-mode` を指定し、テーマ、読者が得たいこと、媒体を伝えます。直接参照する場合は [SKILL.md](SKILL.md) を指定してください。別のリポジトリで使う場合は `.agents/skills/article-mode/` をコピーします。日本語校正の静的検査を併用する場合は [既存 Skill の導入手順](../japanese-proofreading/README.md#セットアップ) を確認してください。

```text
$article-mode で、日本語校正 Skill の仕組みを技術解説記事にしてください。読者は AI が書いたコメントをレビューする開発者で、Zenn と Qiita を対象にします。

$article-mode で、社内の静的サイトの配信方法を比較してください。運用経験が少ないチーム向けに、更新頻度とロールバック手順を比較軸にします。

$article-mode で、Node.js の標準テストランナーを使って最初のテストを実行するチュートリアルを書いてください。読者は JavaScript を書ける人で、環境と期待する出力も記載してください。
```

新規記事では、エージェントが根拠を調べ、構成3案と独立レビューを提示します。採用する案や組み合わせを伝えると、その構成から初稿を1本作成します。既存記事には「見出し・太字・段落冒頭だけのレビュー」のように範囲を指定できます。

Playbook が記事種別の工程を、Principles が共通の判断基準を定めます。調査、校正、可読性・図解の各手順は必要な箇所から参照します。媒体を指定した場合は [Zenn](references/platforms/zenn.md)・[Qiita](references/platforms/qiita.md) の手順で閲覧用 Markdown を作れます。評価ケースと再現方法は [検証ガイド](references/evaluation.md) を参照してください。

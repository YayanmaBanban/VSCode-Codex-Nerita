# 日本語レビュー記録

2026-09-25 に `pnpm textlint` を実行し、生成された `.textlint-cache/audit-all.json` の全2,444件、502ファイルを確認した。警告の有無にかかわらず文章を読み、意味が疑わしいコメントは `file` と `startLine`・`endLine` から元コードを確認して修正した。

対象は監査ファイルに抽出されたコメント・文書であり、`.textlintignore` の除外対象やソース内の表示文字列は含まない。ルートの README は変更していない。作業開始前から変更されていた日本語ガイドの追記は保持し、表記と例の配置を整えた。

## 主な修正と実装上の根拠

| 対象 | 確認した処理と修正 |
| --- | --- |
| `src/extension/backends/codex/CodexSandboxExecutor.ts` | `validateCommand` はシェル許可・引数・制限時間を検査する。別関数が担当するパス検査の説明を修正した。 |
| `src/extension/security/FileSnapshot.ts` | 内容そのものを複製せず、ハッシュと識別情報を記録する。祖先ディレクトリの追加と既存祖先の変更も区別して説明した。 |
| `src/extension/backends/pi/PiRuntimeTools.ts` | 書込み先を実体パスに変換し、親の権限と共通する範囲だけを採用する。「親上限と交差」を具体化した。 |
| `src/extension/backends/pi/codex/CodexProviderControls.ts` | Ultra 選択中も SDK には対応する標準推論値を設定する。「基底」の意味と選択順を明記した。 |
| `src/extension/backends/pi/PiModelCatalogService.ts` | 取得中の変更検出はセッション自体でなく選択モデルを比較するため、説明を合わせた。 |
| `src/extension/backends/pi/PiChildRuntimes.ts` | 終了処理は子の `abort` と `close` を呼ぶ。呼出先と親の追跡から外す時点を修正した。 |
| `scripts/textlint*.mjs` | 診断結果と監査用抽出の役割、コメントの位置維持、NUL 区切り出力から配列への変換を明確にした。 |

文書では一般語として使われていた英語を日本語へ置き換え、素案の「こちら」「このプロジェクト」が指す対象を明記した。過去の検証結果・未達・未検証の区別は維持した。外部プロジェクトの説明は素案作成時の記録として扱い、現在の外部実装を再検証したとは扱わない。

## 検証

- 全体の textlint は初回52件の指摘から、修正後0件になった。
- 変更したソースは TypeScript の構文解析とコメントを除去した出力の比較で、コメント以外に変更がないことを確認した。
- `git diff --check` で空白の問題がないことを確認した。
- コメントと文書だけの変更のため、製品の動作テストと UI の撮影は実施していない。

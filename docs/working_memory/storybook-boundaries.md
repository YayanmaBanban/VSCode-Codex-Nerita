# Storybook の通信境界と検証責務

2026-09-28 時点の境界整理と検証の記録。表にあるテスト名と末尾のコマンドは当時のもの。現在の検証入口は、[フェーズ18の担当と受入結果](Phase-18-Testing-Rebuild.md#担当と受入結果)を参照する。

## ストーリーを追加するとき

- `apps/nerita-ui/stories/chat/fixtures/` に表示状態を置き、`createStoryBridge()` へ渡す。
- 共通ブリッジは送信記録、初回スナップショット、指定された通知の配信だけを扱う。`prompt/send`、承認、認証、セッション操作から結果を計算しない。
- UI 操作は `sent` で確認する。次の表示も検証する場合は、要求の検証後に固定の `HostMessage` または状態差分を注入する。
- 対話デモの認証・フォローアップは、固定の成功・失敗通知と遅延を使える。本文や選択肢から業務処理を組み立てない。
- パス・シンボル・会話参照・添付選択は外部データの境界として残す。独立した管理画面は編集バッファを保持できるが、永続化、承認判断、世代照合を再実装しない。
- 表示への変換には本番の純粋関数を使う。Pi の承認は `toolApprovalPresentation()`、表示項目は `createBuiltinUiRegistry()`、Workflow は共有の解析・コンパイル関数を再利用する。

`StoryChat` が公開する DOM 上の検証窓口は Storybook 専用。本番の Webview には追加していない。

## 状態遷移の担当テスト

| 仕様 | 本番実装を検証する既存テスト |
| --- | --- |
| Codex の送信、取消、新規会話、古い通知の破棄 | `tests/unit/codexSession.test.ts`、`codexSubmission.test.ts` |
| Pi の受付、追加指示、取消、新規会話 | `tests/unit/piSession.test.ts`、`piSteer.test.ts` |
| 承認が1回限りであること、古い回答、取消 | `tests/unit/codexApprovals.test.ts`、`piApprovals.test.ts` |
| 認証・ログアウト | `tests/unit/codexSession.test.ts`、`logout.test.ts`、`piAccount.test.ts`、`piAccountRecovery.test.ts` |
| セッションの復元・分岐・失敗時の保持 | `tests/unit/codexHistory.test.ts`、`piHistory.test.ts`、`tests/pi-persistence-smoke.mjs` |
| バックエンド変更、配置、下書き復元 | `tests/unit/chatViewProvider.test.ts`、`tests/header-smoke.mjs` |
| Pi の実接続と人による承認操作 | `tests/pi-chat-smoke.mjs`、`tests/vscode-sandbox-smoke.mjs` |

Storybook の承認テストは、操作後も応答が届くまでカードが残ることと、選択肢 ID が変換されず送られることを確認する。実行許可の正しさは上記の Controller・実接続テストが担当する。

## レビューで分かった点

- 旧モックの同期的な送信受付は、受付待ちの入力ロックを描画せず、キーボード送信後もフォーカスが残っていた。明示的に受付通知を後から送ると、入力は解除されるがフォーカスは自動復帰しない。今回、本番の挙動は変更していない。貼り付けテストでは、送信内容・受付後の消去・編集再開を検証する。フォーカスの自動復帰は別の UI 改善として検討できる。
- 一部の既存 UI テストは `emulateMedia({ colorScheme })` のみを変更している。Storybook の固定テーマを使うストーリーでは、これだけでは明色にならない。明色の検証には `globals=theme:light` の指定が必要。設定メニューでは明色画像を確認済みだが、既存テスト全体のテーマ指定の統一は今回の対象外。
- 独立画面の編集バッファと Trust の表示用リストは残した。ファイル保存、信頼判定、実行許可を保証するテストとして扱わない。
- 初回の実機ヘッダー検証では起動中にコマンドパレットが閉じ、クリック待ちが失敗した。再実行で表示先の移動と下書きの同期を最後まで確認した。実機テストの起動時の安定化は別途検討できる。

## 検証記録

2026-09-28 に以下を確認した。

- Lint、各 TypeScript 設定の型検査、変更した日本語文章の検査。
- Controller 等の単体テスト 665 件、結合テスト 3 件。
- Storybook 81 件、UI レビュー全体 205 件。最後の表示データ調整後には対象のスクロール追従 1 件と Pi ツール 2 件を再実行した。
- VS Code Extension Host の結合テスト 10 件。
- 実際の VS Code の下書きの移動・同期・復元。
- 同梱 Pi SDK とローカル応答サーバーによる送信、承認、停止、履歴復元。
- 実際の VS Code の Pi 承認画面で、Trust、許可、拒否、停止、再読込み後の再接続、Trust 取消しの 6 シナリオ。

画像比較はヘッダーの狭幅、Pi 承認詳細、子の停止、セッション一覧、ツール結果、明色の設定メニューを対象とした。比較用の全体結果は `dist/ui-review-history/story-boundary-20260928/` に保存した。実機の結果は `dist/header-smoke/` と `dist/vscode-sandbox-smoke/` に保存した。実認証を操作するログインと、外部モデルへの Codex 送信は実行していない。

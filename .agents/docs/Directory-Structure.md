# Webviewのディレクトリ構成

`src/webview/` のファイル追加・分割・移動時に参照します。以下のパスはこのディレクトリからの相対パスです。Extension Host用の `src/extension/` にはこの構成を機械的に適用しません。

## 配置の判断

同じ機能に属する実機用のComponent・Hook・API・型・CSSを近くに置きます。Storybook専用コードは `src/stories/` に分離し、実機側に対応する機能別の構成にします。

| 役割 | 配置 |
| --- | --- |
| Reactの起動 | `index.tsx` |
| 画面の組み立て・全体の状態・機能間の連携 | `chat/ChatApp.tsx`・`chat/useChat.ts` |
| 共通テーマ | `chat/chat.css` |
| 機能固有のUI・処理・型 | `chat/`・`chat/tools/` |
| WebviewとHostの通信 | `vscodeBridge.ts` |
| Hostと共有する通信型・検証処理 | `../shared/` |

既存の配置は `src/webview/` で確認できます。追加説明はルートの `README.md` にありますが、配置の判断基準はこのガイド内で完結しています。

## 分割と共通化

- 小さい機能は同じフォルダにファイルを並べる構成から始め、責務やファイル数が増えたら `components/`・`hooks/` などへ分ける。空の分類フォルダは作らない。
- 大きいComponentは、その機能内でComponent・Hookへ分割する。行数の目安だけを理由に、意味のない階層や再exportファイルを増やさない。
- 複数箇所で使うツールカード専用ボタンは `chat/tools/` に置く。機能固有のデータや操作を知らずに使えるボタンは共通化の候補になる。
- 共通化は利用回数や見た目だけで判断せず、役割と変更理由が共通かを確認する。迷ったらまず機能側に置く。
- 別機能に同名の `Header.tsx` があってもよい。ファイル名はパスと合わせて判断する。
- 画面固有の処理はその近くに置き、複数画面にまたがる処理は役割と変更理由に応じてまとめる。

## WebviewとExtension Hostの境界

Webview側から `src/extension/` やVS Code API・Node.js専用モジュールをimportしません。Hostとの通信は `vscodeBridge.ts` のメッセージ経由で行い、両側に必要な型・検証処理はNode.jsに依存しない `src/shared/` へ置きます。Webview用とHost用のexportを同じ公開ファイルにまとめないでください。

## Story・テストと移動時の確認

Storyは `src/stories/chat/`、ツールカードのStoryは `src/stories/chat/tools/` に置きます。Story専用のBridge・応答モックは `src/stories/chat/mocks/`、Storyと単体テストで共有するサンプルデータは `tests/fixtures/` に置きます。

実際のUIコンポーネントは `src/webview/` に置き、Story側からimportします。実機用コードからStory・モック・テストフィクスチャをimportしません。結合テスト・E2Eは引き続きルートの `tests/` に置きます。

Storyの型検査は `src/stories/tsconfig.json`、Story専用のTailwindクラスの収集は `config/storybook/tailwind.css` が担当します。本体のTailwind走査対象へStoryを追加しません。

移動時はimport・再export・CSSだけでなく、拡張機能URIを基準にした資産パス、esbuild・Storybook・テストの検出設定、スクリプト・文書の旧パスも更新してください。変更の影響に応じて型チェック・ビルド・関連テストで参照切れを確認します。

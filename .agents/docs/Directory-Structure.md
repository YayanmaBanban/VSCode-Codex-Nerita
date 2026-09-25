# ソースのディレクトリ構成

`src/webview/`・`src/extension/`・`src/shared/` のファイル追加・分割・移動時に参照します。配置・分割・共通化の判断基準は3領域に適用し、Component・フックなど React 固有の構成は Webview に適用します。以下のパスはリポジトリルートからの相対パスです。

## 配置の判断

まず実行環境で領域を選び、その中で同じ機能に属する処理・型を近くに置きます。Webview ではコンポーネント・Hook・CSS、Extension Host では VS Code 連携・プロセス通信、shared では共有する通信型・検証処理を責務に応じてまとめます。Storybook 専用コードは `src/stories/` に分離し、実機側に対応する機能別の構成にします。

| 役割 | 配置 |
| --- | --- |
| React の起動・画面の組み立て | `src/webview/index.tsx`・`src/webview/chat/` |
| 共通 UI 部品・テーマ | `src/webview/ui/`・`src/webview/chat/chat.css` |
| Webview 側の Host 通信 | `src/webview/vscodeBridge.ts` |
| 拡張機能の起動・VS Code 連携 | `src/extension/extension.ts`・`src/extension/webview/` |
| バックエンド固有のエージェント連携 | `src/extension/backends/codex/`・`src/extension/backends/pi/` |
| Host 共通のセッション・添付処理 | `src/extension/session/` |
| 両側で共有する通信型・検証処理 | `src/shared/` |

既存の配置は各領域で確認できます。追加説明はルートの `README.md` にありますが、配置の判断基準はこのガイド内で完結しています。

## 分割と共通化

- 小さい機能は同じフォルダにファイルを並べる構成から始め、責務やファイル数が増えたら責務別に分ける。Component・フックの分類は Webview で必要な場合に使い、空の分類フォルダは作らない。
- 大きいファイルは、その機能内で責務ごとに分割する。Webview ではコンポーネント・Hook、Host では制御・通信・データ変換、shared では契約・検証などを分割の候補にする。行数の目安だけを理由に、意味のない階層や再エクスポートファイルを増やさない。
- 複数箇所で使うツールカード専用ボタンは `src/webview/chat/tools/` に置く。機能固有のデータや操作を知らずに使える UI 部品は `src/webview/ui/` への共通化の候補になる。
- 共通化は利用回数や見た目だけで判断せず、役割と変更理由が共通かを確認する。迷ったらまず機能側に置く。
- 別機能に同名のファイル（Webview の `Header.tsx` など）があってもよい。ファイル名はパスと合わせて判断する。
- 機能固有の処理はその近くに置き、複数機能にまたがる処理は役割と変更理由に応じてまとめる。同じ領域内で使い回すだけの処理を、領域間共有用の `src/shared/` へ移さない。

## Webview と Extension Host の境界

Webview 側から `src/extension/` や VS Code API・Node.js 専用モジュールをインポートしません。Host 側も `src/webview/` の UI 実装をインポートせず、通信は `src/webview/vscodeBridge.ts` のメッセージ経由で行います。両側に必要な型・検証処理は `src/shared/` へ置き、shared から両領域の実装や React・DOM・VS Code API・Node.js 専用 API に依存させません。Webview 用と Host 用のエクスポートを同じ公開ファイルにまとめないでください。

## Story・テストと移動時の確認

ストーリーは `src/stories/chat/`、ツールカードのストーリーは `src/stories/chat/tools/` に置きます。ストーリー専用の Bridge・応答モックは `src/stories/chat/mocks/`、ストーリーと単体テストで共有するサンプルデータは `tests/fixtures/` に置きます。

実際の UI コンポーネントは `src/webview/` に置き、ストーリー側からインポートします。3領域の実機用コードからストーリー・モック・テストフィクスチャをインポートしません。Host・shared の単体テストは `tests/unit/`、結合テスト・E2E もルートの `tests/` に置きます。Storybook の確認で Host や実際の Codex App Server 接続の検証を代替しません。

ストーリーの型検査は `src/stories/tsconfig.json`、ストーリー専用の Tailwind クラスの収集は `config/storybook/tailwind.css` が担当します。本体の Tailwind 走査対象へストーリーを追加しません。

移動時はインポート・再エクスポート・CSS だけでなく、拡張機能 URI を基準にした資産パス、esbuild・Storybook・テストの検出設定、スクリプト・文書の旧パスも更新してください。変更の影響に応じて型チェック・ビルド・関連テストで参照切れを確認します。

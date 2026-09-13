# 実装状況と検証結果

2026-09-13 に `Implementation-Plan.md` の MVP を実装。Windows x64 / VS Code 1.137.0 / Node.js 24.18.1 で検証した。

## 実装した内容

| 計画の段階    | 実装・確認                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 0. 基盤整備   | Host / Webview のエントリーと型環境を分離。設定パスを修正し、実際の Extension Host でテストを実行        |
| 1. 接続検証   | codex-acp 1.11.0 / SDK 1.4.0 / Codex 0.153.4。初期化、既存認証による会話作成、実応答、プロセス終了を確認 |
| 2. UI・通信   | サイドバー WebviewView、CSP、React、型付き双方向 Bridge、実行時検証、代替 Bridge、Story                  |
| 3. 会話統合   | 逐次応答、送信・停止、新規会話、正本のスナップショット復元、番号による古い通知の排除、同時実行防止       |
| 4. 操作・障害 | ツール・変更ファイル概要、承認・拒否、認証画面、エラー・再接続、タイムアウト、切断時の承認解消           |
| 5. 配布準備   | Windows x64用VSIX、実行依存の実体コピー、導入手順、テスト用プロファイルへのインストールと実会話          |

## 採用した仕様

- 画面はサイドバー。Webview を閉じても Host の会話と実行を保持する。
- 停止時は `session/cancel` を送り、完了または5秒の期限でプロセスを終了する。ACP 通知に実行IDがないため、停止後は再接続して新しい会話を開始する。
- ワークスペース変更時には接続を無効化する。起動対象は信頼済みの単一ローカルフォルダーに限定する。
- 既存認証を再利用。未認証時は初期化応答に含まれる `chat-gpt` / `api-key` のみ選択可能。APIキーは起動環境から adapter が読む。
- クライアントのファイル・端末能力は宣言しない。ファイル・コマンド操作は Codex / adapter に委譲する。
- adapter の生ログと認証メタデータを Webview・出力チャネルへ流さない。エラーは利用者向けの固定文に変換する。
- 本番UIは `vscodeBridge.ts` からだけ VS Code API を呼ぶ。コードフェンスは React 要素へ変換し、未検証HTMLは挿入しない。
- VSIX は現在の Windows x64 用 adapter / Codex 実行資産を同梱。Node.js 本体は別途導入する。Marketplaceへの公開や署名は実施しない。

## 実行した検証

| 検証                                                      | 結果                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Host / Webview 型検査、テスト型検査、開発設定型検査、Lint | 成功                                                                                                                     |
| `pnpm test:unit`                                          | 10件成功。不正要求、重複送信、逐次応答、承認の重複回答、切断、遅延通知、停止期限、認証エラー、ツール差分、実プロセス終了 |
| `pnpm test:storybook`                                     | 9件成功。8つの表示状態と送信操作                                                                                         |
| `pnpm ui-review`                                          | 7件成功。送信・新規会話、承認、拒否、停止・再接続、IME・改行、320px幅の明暗テーマ                                        |
| `pnpm test`                                               | 実際の Extension Host で1件成功。起動、コマンド登録、同梱資産、Webviewを開く操作                                         |
| `node tests/acp-smoke.mjs`                                | 実際の Codex から `ACP_OK` を受信し、adapter の終了を確認                                                                |
| `node tests/installed-smoke.mjs`                          | インストール済みVSIXの実Webviewから `ACP_INSTALLED_OK` を受信。Explorerへの切り替え後の会話復元、停止、再接続を確認      |
| Storybook静的ビルド・本番バンドル・VSIX作成               | 成功                                                                                                                     |

実プロセステストは、空白を含む作業パスで初期化・会話作成を行い、終了後に子・孫プロセスのPIDが残らないことと、保留中RPCの解放を確認する。インストール後の検証も空白を含む専用ワークスペースを使う。

UI画像を実際に開き、狭い幅の明暗テーマ、空状態、承認待ち、実VS Code上の会話を確認した。最初のUIレビューではIMEをOS入力のように再現できていないテストと、依存追加直後のViteキャッシュ更新による504があった。イベントを修正し、キャッシュ更新後に全件成功した。

## 成果物と再現手順

- VSIX: `dist/codex-acp.vsix`（Codex実行資産を含むため約136MB）。
- UIレビュー: `dist/ui-review/report/index.html`、`dist/ui-review/test-results/`。
- 初回比較資料: `dist/ui-review-history/initial/`。
- 実VS Code画像: `dist/installed-smoke/conversation.png`、`dist/installed-smoke/cancelled.png`。

実機テストの再現は次のとおり。通常のユーザープロファイルにはインストールしない。

```powershell
pnpm.cmd package:vsix
code.cmd --user-data-dir dist/installed-smoke/profile --extensions-dir dist/installed-smoke/extensions --install-extension dist/codex-acp.vsix --force
$env:VSCODE_EXECUTABLE = 'C:\path\to\Code.exe'
node tests/installed-smoke.mjs
```

専用ワークスペースのテストでは Trust のダイアログを起動引数で省略している。本番拡張機能の Trust 制限はmanifestとHost側で適用する。

## F5起動の修正と検証

開発元と同じフォルダーを起動引数に指定すると、VS Code 1.137.0がその指定を除外し、開発用Hostにフォルダーが開かれない現象を再現した。`.vscode/development.code-workspace` 経由で同じプロジェクトルートを開くよう修正した。

`node tests/launch-smoke.mjs` で実VS Codeの「Run Extension」を開始し、起動前ビルドから開発用Hostの表示、ACPの「接続済み」まで確認した。画像は `dist/launch-smoke/connected.png`。テストでは信頼ダイアログを省略している。

フォルダー未選択・制限モード・リモート・複数フォルダー・仮想環境を区別した案内を追加した。単体テストは14件成功し、内部例外の秘密情報をUIに出さないことも確認した。

## 未確認・対象外

- ブラウザでの新規ChatGPTログイン完了と、新しいAPIキーによるログインは未確認。既存の認証を使った実会話を確認済み。
- 実際のファイル書き換えに伴う承認操作は未実施。承認・拒否・変更概要はACP形式のHostテストとStorybook / Playwrightで検証した。
- Windows x64以外、Node.js 22での実機動作、Remote / WSL / Dev Containers、Web、複数フォルダー、再起動をまたぐ履歴は未検証またはMVP対象外。

仕様の根拠は導入済みパッケージのREADME・型定義・実行結果と、[ACP初期化仕様](https://agentclientprotocol.com/protocol/v1/initialization)。公開仕様より導入済みSDKの実際のAPIを優先した。

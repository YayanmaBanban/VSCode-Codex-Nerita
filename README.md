# Nerita for Codex

Codex App Server への移行を完了しました。実装内容と検証手順は、同梱の `docs/App-Server-Migration.md` を参照してください。

VS Code のサイドバーから Codex App Server に接続します。テキスト送信、逐次応答、停止後の続行、新規会話、ツール・差分表示、承認、モデル設定、認証、使用量、添付に加え、履歴の復元・名前変更・Fork・アーカイブと解除に対応します。

## Pi backend（最小疎通）

設定で `"nerita.backend": "pi"` を指定し、VS Codeのウィンドウを再読み込みするとPiを使用します。既定値は `codex` です。
Pi SDK `@earendil-works/pi-coding-agent@0.86.1` を同梱します。SDKの要件はNode.js 22.19以降で、実行にはExtension HostのNode.jsを使います。
SDKは公開エントリーから読み込みます。ビルド時に `dist/runtime/pi.mjs` を生成し、実行依存・相対参照資産をリンクなしで同梱します。HostはSDK内部のディレクトリ構成に依存しません。

認証はPi側の `~/.pi/agent/auth.json`、providerのAPIキー環境変数、`models.json` を利用します（`PI_CODING_AGENT_DIR` を指定している場合はそのディレクトリ）。Codexの認証は共有しません。
Pi CLIでログインするか、対応providerのAPIキーをVS Code起動時の環境に設定してください。キーはNeritaの設定に保存しません。
モデルはPiの設定に従います。明示する場合は `nerita.pi.provider` と `nerita.pi.model` を両方指定し、再接続してください。

現段階はテキスト送信・ストリーミング・Stop・停止後の再送・新規会話・履歴の保存と再開に対応します。セッション一覧から保存済みの会話を選ぶと、本文とツール結果を復元して続けられます。承認待ちや未完了のツールは自動再開しません。

`nerita.pi.sessionStorage` で保存先を選べます。

- `global`（既定）：Pi標準の `~/.pi/agent/sessions/<作業フォルダー別の名前>/`。`PI_CODING_AGENT_DIR` を指定した場合はその配下です。
- `workspace`：`<ワークスペース>/.sessions/`。初期化時に `.sessions/.gitignore` を内容 `*` と改行だけで生成し、既存の `.gitignore` は上書きしません。すでにGitで追跡中のファイルは無視対象になりません。

ワークスペースのVS Code設定で `"nerita.pi.sessionStorage": "workspace"` を指定できます。保存先変更は新規会話・再接続から適用し、既存履歴は自動移動しません。開いている会話とその一覧は元の保存先を使用します。ワークスペースを `.sessions/` ごと移動した場合も、移動先で履歴を開けます。起動時は新しい会話で始まり、保存済みの会話は一覧から選択します。
履歴はPi標準のJSONL形式です。SDKは最初のAssistant応答が確定した段階から保存するため、送信前の空の会話や、それ以前に失敗した送信は一覧に残りません。
ツールは `read` / `ls` と、毎回の承認が必要な `write` / `edit` / `powershell` に対応します。承認カードに作業フォルダーと入力（変更内容・コマンド）を表示し、「今回のみ許可」「拒否」「ターンを中止」を選べます。拒否はその操作を実行せずモデルへ返し、中止・Stop・切断では承認待ちを解除します。Tool Cardに対象パス・実行中・成功・失敗・停止と結果を表示し、継続会話でも過去の結果を保持します。
Piの承認は操作ごとの確認です。OSのサンドボックスやワークスペース内だけの書き込み制限はなく、許可した操作はExtension Hostのユーザー権限で動作します。Stopは実行済みの変更を元に戻しません。追加指示・履歴の名前変更／Fork／削除／アーカイブ・添付・Pi拡張の自動ロードは後続工程です。未対応の操作は送信元へエラーを返します。

`pnpm compile` 後の `pnpm test:pi:chat` で、配布SDKをリポジトリ外にコピーし、ローカルのOpenAI互換サーバーに対して会話・ツール・承認・停止・保存先切替・再起動後とフォルダー移動後の復元を検証できます。外部モデルへの通信・課金は発生しません。
`pnpm test:runtime` は梱包処理の依存解決・バージョン分離を検証します。展開したVSIXは `pnpm test:pi:chat <展開先のextensionフォルダー>` で検証できます。`NERITA_TEST_EXTENSION_PATH` に同じフォルダーを指定すると、`pnpm test` も配布物をExtension Hostで検証します。
画面の確認は `pnpm ui-review pi.spec.ts pi-tools.spec.ts pi-approvals.spec.ts pi-history.spec.ts --workers=1` です。Storyの通信モックによる表示確認と、実SDKの疎通検証は別に実行します。

## インストールと使い方

1. Windows x64、VS Code 1.137 以降、Node.js 22 以降を用意します。
2. 拡張機能メニューの「VSIX からのインストール」で `dist/nerita.vsix` を選びます。
3. 信頼済みのローカルフォルダーを一つ開き、「Nerita for Codex: チャットを開く」を実行します。
4. 「接続する」を押し、メッセージを入力します。Enter で送信、Shift+Enter で改行します。

同梱のネイティブ Codex を直接起動します。Codex CLIの別途インストールや実行パスの指定は不要です。

既存の Codex 認証・`CODEX_HOME`・設定を引き継ぎます。未認証の場合は「ChatGPTでログイン」または「環境変数のAPIキーを使用」を選びます。CLIの `codex login` も利用できます。

表示中の会話は Extension Host の稼働中に保持します。サイドバーを閉じても実行を続け、再表示時に状態を復元します。停止後は同じ会話で続けられます。再接続では新規会話を作成します。ヘッダーの「セッション一覧」から同じ作業フォルダーの保存済み会話を開けます。「さらに読み込む」で次ページ、「アーカイブ済み」で保管した会話を表示します。名前変更・Fork・アーカイブ・解除は各行のボタンから操作します。

ファイル・コマンド操作は Codex が実行します。承認要求には「今回のみ許可」「拒否」「ターンを中止」で回答します。モデル・推論量・実行権限・速度は次のターンに適用します。Collaboration modeの変更は未対応です。

## 性格設定

接続後、上部の「オプション」→「性格設定」から、グローバルとワークスペースの指示を編集できます。プリセット名を変えると新規保存、本文だけを変えると更新します。「なし」を選ぶとその保存先のプリセットを適用しません。

プリセットと選択状態は、グローバルが `~/.codex/nerita/preset.toml`、ワークスペースが `<ルート>/.codex/nerita/preset.toml` に保存されます。複数プリセットにはTOMLの配列テーブル `[[presets]]` を使います。

```toml
selected = "簡潔"

[[presets]]
name = "簡潔"
text = "日本語で簡潔に回答する。"

[[presets]]
name = "技術説明"
text = "技術的な判断理由を具体的に説明する。"
```

グローバルとワークスペースの有効な指示をこの順で結合し、`thread/start`・`thread/fork`・`thread/resume` の `developerInstructions` に渡します。進行中の会話への即時反映は行いません。

`$CODEX_HOME/config.toml`（未指定時は `~/.codex/config.toml`）または `<ルート>/.codex/config.toml` に `developer_instructions` がある場合、対応するペインに内容を表示し、選択・編集・保存を禁止します。コマンドなどのプロジェクト固有の開発手順は `AGENTS.md` に記載してください。

## 開発・配布

```sh
pnpm install
pnpm compile
pnpm test:unit
pnpm test
pnpm package:vsix
```

Windows の PowerShell で実行ポリシーにより起動できない場合は `pnpm.cmd` を使います。「実行とデバッグ」で `Run Extension` を選択して F5 を押すと、型検査・Lint・Host / Webview のビルド・Codex実行資産の準備後に、同じフォルダーを開いた Extension Development Host が起動します。開いたウィンドウで「Nerita for Codex: チャットを開く」を実行し、「接続する」を押してください。コード変更後はデバッグを再起動すると再ビルドされます。

`pnpm package` は本番バンドル、`pnpm package:vsix` は Windows x64 用 VSIX を生成します。Windows x64 上で作成してください。VSIX は Codex 0.154.0 の Windows x64 実行資産を `dist/runtime/node_modules/@openai/` に、Pi SDKとその実行依存を同じ `node_modules` 以下に同梱し、開発ツリーの `node_modules` を必要としません。旧ACPアダプター・SDK・旧Codexは削除済みです。署名・Marketplace 公開は行いません。

`pnpm check-types` は Host / Webview / Story、`pnpm check-types:tests` は Host テスト、`pnpm check-types:tools` は Storybook / Vitest / Playwright 設定を検査します。`pnpm test:codex` は同梱App Serverの初期化を、`pnpm test:codex:chat` は認証済みの実モデルで返信・停止・同じthreadでの続行を確認します。後者はモデル使用量が発生します。

インストール済み VS Code を拡張機能テストに使用する場合は、`VSCODE_EXECUTABLE` に `Code.exe` のパスを設定して `pnpm test` を実行します。指定がない場合、VS Code Test CLI がテスト用 VS Code を取得します。

実行対象はローカルの単一フォルダーで、同時実行は一会話です。Remote / WSL / Dev Containers、Web、複数フォルダー、MCP設定UIは対象外です。現在の移行状況と検証結果は `docs/App-Server-Migration.md`、当初の設計は `docs/Implementation-Plan.md` を参照してください。

### F5起動時のフォルダー

`launch.json` は `.vscode/development.code-workspace` を開き、プロジェクトルートを作業場所にします。VS Codeが開発元と同じフォルダーの指定を除外するため、専用ワークスペースを経由します。設定変更前の開発用ウィンドウは閉じ、デバッグを停止してから F5 で起動し直してください。

手動で開いたウィンドウにフォルダーがない場合は、そのウィンドウの「ファイル → フォルダーを開く」で作業場所を選びます。信頼の確認が出た場合は内容を確認して信頼を設定し、チャットから接続してください。

`VSCODE_EXECUTABLE` を指定して `node tests/launch-smoke.mjs` を実行すると、専用プロファイルで `Run Extension` の起動前ビルド・開発用Hostの起動を検証します。既存のCodex認証が必要です。

同じ検証で本体 Webview の入力欄・ボタンの寸法、入力による送信可否、モデルメニューの表示と
Escape での閉じ操作も確認します。画像と寸法・配色の記録は `dist/launch-smoke/` に保存します。
検証用の入力は送信しません。

## 開発ツールの配置

共通UI部品は `src/webview/ui/` に置きます。`src/webview/chat/` は画面の組み立てと共有状態を直下に残し、
入力・補完・添付を `composer/`、発言の表示を `messages/`、接続ヘッダーを `connection/` にまとめています。
履歴・検索・性格設定・エージェント・ツール表示は、それぞれ既存の機能別フォルダに置きます。
Storyも `src/stories/chat/` 内で対応する機能別の配置にします。
`src/extension/backends/codex/` は制御クラスを直下に残し、
応答・通知の検証を `protocol/`、表示項目・イベントの変換を `items/`、
エージェント管理を `agents/`、プロセス起動・通信・接続契約を `runtime/` にまとめています。
添付・差分・会話参照は `context/`、履歴の復元と一覧の補助処理は `history/`、
モデル・権限・性格設定は `settings/`、承認・認証・入力UIとの連携は `interaction/` に置きます。
Piは `src/extension/backends/pi/`、backendの生成は `backends/createBackend.ts` に置きます。
`src/extension/session/` は共通の通信・寿命管理契約、状態ストア、添付サービスと入力検証を持ちます。
`src/extension/webview/` では表示先の制御、通信購読の寿命、CSP付きHTMLの生成を分離しています。

### Webview のスタイル

Tailwind CSS の入口は `src/webview/chat/tailwind.css` です。本体では
`config/tailwind-esbuild.cjs`、Storybook では Vite プラグインで同じ CSS を生成します。
`pnpm watch` は Webview のクラス変更・ファイル追加も CSS に反映します。

Story専用のクラスは `config/storybook/tailwind.css` から追加で収集します。
本体ビルドは `src/webview/` のみを走査するため、Storyの装飾は本体CSSに混ざりません。

画面配置・設定メニュー・添付・メッセージ・承認カード・ツールカード・ファイル差分の通常スタイルを移行済みです。
ツール本文の共通クラスは `src/webview/chat/tools/toolStyles.ts`、発言操作の共通クラスは
`src/webview/chat/messages/messageStyles.ts` にまとめています。残す CSS は、基本スタイルの `chat.css`、
Tailwind のテーマ定義 `tailwind.css`、専用アニメーションの `loaders.css` と `composer/quotaBar.css` などです。Preflight は使わず、
既存の基本スタイルを維持します。色は `text-muted`・`bg-input` などの用途別トークンを
通じて VS Code のテーマ変数を参照します。既存の寸法を保つ箇所には px の任意値を使います。
専用 CSS と併用する場合、レイヤー外の既存 CSS がユーティリティより優先されるため、
移行した宣言は旧 CSS から削除します。クラス名は動的に組み立てず、完全な文字列で記述します。

Storybook / Playwright の設定と生成物は、ルートから分離しています。

| 用途                           | 配置                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| Extension Host / 共通通信型    | `src/extension/` / `src/shared/`                           |
| Webview / 型設定               | `src/webview/` / `src/webview/tsconfig.json`               |
| Storybook 設定                 | `config/storybook/`                                        |
| Story / 型設定                 | `src/stories/` / `src/stories/tsconfig.json`               |
| Story専用モック                | `src/stories/chat/mocks/`                                  |
| Story・単体テスト共有データ    | `tests/fixtures/`                                          |
| Story / Host の Vitest 設定    | `config/vitest.config.ts` / `config/vitest.host.config.ts` |
| Playwright 設定                | `tests/e2e/config/ui-review.config.ts`                     |
| Playwright シナリオ            | `tests/e2e/ui-review/chat.spec.ts`                         |
| Storybook 静的ビルド           | `dist/storybook/`                                          |
| UI画像・動画・trace / レポート | `dist/ui-review/test-results/` / `dist/ui-review/report/`  |
| 実行依存の梱包処理             | `config/package-runtime.cjs`                               |

```sh
pnpm storybook
pnpm build-storybook
pnpm test:storybook
pnpm ui-review
pnpm ui-review:report
```

`test:storybook` は Story のブラウザテスト、`ui-review` は独立した Playwright テストです。`pnpm test` は VS Code 拡張機能の結合テストです。UIレビューは Storybook を自動起動し、Chromium で送信・承認・停止・再接続・IME・明暗テーマを操作・撮影します。成功時も画像・動画・trace を保存します。

Mocha 用の `tests/tsconfig.json` からは `tests/e2e/` を除外しています。生成物は `dist/`、拡張機能テストのコンパイル結果は `out/` に出力し、Git 管理対象にしません。

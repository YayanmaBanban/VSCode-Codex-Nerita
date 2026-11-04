# プロジェクト固有の検証環境

検証方針の決定、テストや UI の変更・レビュー時に参照する。

以下のパスはリポジトリルートからの相対パスとする。

## テストの配置

実装中の動作確認や不具合の一時的な再現には `tests/scratch/` を使う。一時的な UI 操作スクリプトもここに置く。Git 管理に含めるが、通常のテスト実行・CI・Storybook の自動収集からは除外し、必要なファイルを明示して実行する。

継続して製品の回帰を検出するテストは `tests/product/`、`tests/vscode/`、`apps/nerita-ui/stories/` などに置く。共通の補助コードは `tests/support/` に置く。

## UI の検証環境

### ブラウザーの選択

単独のブラウザーを起動する検証では、`tests/support/browser.cjs` の `launchBrowser()` を使う。インストール済み Google Chrome を起動し、同梱 Chromium にはフォールバックしない。`headless` や追加の起動引数は関数の引数で渡し、呼び出し側の `finally` で `browser.close()` を待つ。

Playwright Test のフィクスチャでブラウザーを管理する場合は、対象の設定に `channel: "chrome"` を指定する。これは `playwright.config.cjs` と同じ設定であり、テスト内ではブラウザーを別途起動しない。

### 検証目的と条件の選択

既存の操作テストは Storybook の Vitest 連携から選択して実行する。撮影や幅ごとの検証など、既存のストーリーでは足りない一時検証を Playwright Test で追加する場合は、`tests/scratch/*.spec.cjs` に置く。ケース名またはタグで選択できるようにする。

| 検証目的 | 条件の目安 | 検証が必要な変更 |
| --- | --- | --- |
| 照合・削除・保存などの振る舞い | 標準幅・代表テーマ | 対象の動作変更時 |
| レスポンシブの境界 | 360 / 520 / 1200px を目安に、実際の切り替えの前後も選ぶ | 対象のレイアウト変更時 |
| 明暗テーマの外観 | `dark2026` / `light` と、変更に関係する幅・状態 | 対象の見た目変更時 |
| 実際の保存・信頼・権限・通信 | 専用プロファイルで起動した VS Code | 対象の Host 処理・通信境界・保存や権限の経路を変えたとき |

幅によって選択欄がサイドバーへ変わるなど操作経路が異なる場合は、各経路の振る舞いも確認する。表の条件を直積にして全操作を繰り返さない。共通 UI やテーマ全体の変更では、影響する画面・状態を追加する。

### ケースを指定するコマンド

次は既存の Guardrails ストーリーのうち、例外削除だけを実行する例。Vitest のファイル指定は UI パッケージからの相対パスで渡す。

```powershell
pnpm.cmd test:storybook stories/pi/guardrails/Guardrails.stories.ts -t "Delete Exception"
```

UI のスクラッチは `tests/scratch/playwright.config.cjs` で収集し、ファイルに加えてケース名やタグを指定する。

```powershell
pnpm.cmd test:scratch guardrails-layout-review.spec.cjs --grep "照合のメニュー"
pnpm.cmd test:scratch guardrails-layout-review.spec.cjs --grep "@layout"
pnpm.cmd test:scratch --list
```

Storybook の URL を開くケースは、まず Storybook MCP の接続を確認し、接続済みなら既存サーバーを使う。未接続の場合も対象 URL の応答を確認し、Storybook が未起動の場合だけ別プロセスで `pnpm storybook` を起動する。

ケースを追加・分離したら、対象ファイルと `--grep` に `--list` を付けて選択対象を確認し、そのケースだけを実行する。`pnpm test:scratch` は対象ファイルの指定を必須とし、`--list` の場合だけ全ファイルの一覧を許可する。一覧の収集ではブラウザーや Storybook を起動しない。

Node.js・VS Code 本体・MXC を使うスクラッチは、`node:test` のケース名で選択する。たとえば次はファイル書き込みの許可・拒否だけを実行する。

```powershell
node --test --test-name-pattern "書き込みの許可と拒否" tests/scratch/mxc-acceptance.cjs
```

### 一時検証の設定と成果物

専用設定の `testDir` は `tests/scratch/` に限定し、ルートの Playwright 設定ではこのフォルダを除外している。通常のテスト・CI・Storybook からは実行しない。`config/test-scratch.cjs` はテスト定義と同じ `@playwright/test` の CLI を使う。ルートの `playwright` とはバージョンが異なる場合もあるため、スクラッチは `pnpm test:scratch` で実行する。

`tests/support/scratch-test.cjs` は、ケースごとに作成した `context` を終了時に閉じ、実行時エラーと失敗時の画面を記録する。画像・JSON は `testInfo.outputPath()` を基準に、実行ごとの `dist/ui-review/scratch-*/` 配下へ保存する。Storybook が配信しない favicon への自動要求には検証用の空応答を返し、その他のコンソールエラー・ページエラーはテストを失敗させる。

### 比較条件と実行順序

比較用の `before` / `after` を切り替えるケースでは、`SCRATCH_PHASE` で比較の段階を指定する。チャットの履歴を入力にする性能計測では、`SCRATCH_HISTORY` で入力を指定する。テストから製品ソースを過去の版へ書き換えず、比較したいチェックアウトを先に用意する。

初回・再実行・ウォームアップの性能比較、保存後の再起動、会話操作の反復によるメモリ計測は、順序自体が検証条件なので1つのケース内にまとめる。別のケースが準備した履歴・ファイル・プロセスには依存させない。補助モジュールや子プロセス内の計測処理は、対応するケースから呼び出す。

### Storybook の通信境界

テスト設定は `apps/nerita-ui/vitest.config.mts`、ストーリーは `apps/nerita-ui/stories/**/*.stories.ts` に置く。必要な状態や操作ラッパーは、ストーリーと同じ領域の `.svelte` ファイルに置く。

Playwright からストーリーを開いた後に独自の操作を始める場合は、まず `play` の完了を待つ。待機には `tests/support/scratch-test.cjs` の `waitForStory(page)` を使う。描画された要素が見えたことだけで、ストーリー側の操作も終わったと判断しない。

ストーリーは製品のソースと同じ機能別の構成にし、製品コンポーネントに検証開始時の状態を与える。表示用データは `apps/nerita-ui/stories/chat/fixtures/` に置く。

`pnpm check` は製品・ストーリーの `svelte-check` と TypeScript の検査を含む。Svelte の警告も修正する。Svelte コンパイラーは Storybook の Vite 設定に一度だけ追加する。

`createStoryBridge()` が返すブリッジは、`sent` に送信メッセージを記録する。検証側は `emit()` で指定した Extension Host の応答を配信し、`patchState()` で状態の差分を配信する。

表示デモの編集バッファと、本番の保存・信頼判定を区別する。承認後の完了状態を注入しても、実行許可の正しさを検証したことにはならない。

### VS Code 上の Webview の受け入れ検証

シナリオは `tests/vscode/webview.cjs` と `tests/vscode/account.cjs` に置く。`config/test-distribution.cjs` で VSIX を新規生成し、`config/test-webview.cjs` で専用プロファイルを使って VS Code を起動する。

モデル応答だけをローカルの HTTP サーバーで代替し、画面操作に伴う処理は実際の Extension Host で行う。次の点を確認する。

- 承認前にファイルが作られていないこと
- 承認後のファイル内容
- 停止後にファイルが作られていないこと

VS Code の拡張テストモードは確認ダイアログを禁止するため、通常の開発用 Extension Host と一時的な補助拡張で実行する。専用プロファイルの `window.dialogStyle` は `custom` に設定する。利用者のプロファイルには拡張機能をインストールせず、設定も変更しない。

#### ACL エラーが発生した場合の起動

サンドボックス内からの起動で ACL エラーが発生する場合は、サンドボックス外からの起動を試す。`exec_command` には `sandbox_permissions: "require_escalated"` を指定する。実行するコマンドは次のとおり。

```powershell
rtk proxy pnpm.cmd run test:webview vscode-bridge webview-backend
```

この指定は Windows の管理者起動や ACL 変更を意味しない。検証では新規 VSIX と隔離プロファイルを使用する。過去の一時ラッパーや生成済み VSIX は、そのまま再利用しない。

## 実行コマンド

| コマンド | 用途・確認内容 |
| --- | --- |
| `pnpm storybook` | ストーリーを開いて確認する。 |
| `pnpm test:local` | 日常のローカル検証を行う。対象テストを選ぶ場合は `pnpm test:product <ファイル名の一部>` を使う。 |
| `pnpm test:regressions` | 通常の実装でテストが成功することと、意図的に不具合を加えた実装でアサーションが失敗することを確認する。 |
| `pnpm test:distribution` | 実行時に生成した VSIX を展開し、同梱 SDK と実際の Extension Host を検証する。 |
| `pnpm test:windows` | 新規 VSIX の Codex を使い、実際の Windows サンドボックスの書き込み制限と、停止時に子孫プロセスが終了することを検証する。 |
| `pnpm test:webview` | VS Code 上の Webview の信頼操作・再接続・承認・停止・認証の取り消し・設定の切り替え・履歴の復元を検証する。 |
| `pnpm test:external` | 導入済み Pi 拡張の受け入れ検証を行う。 |
| `pnpm test:storybook` | Storybook の表示・操作を検証する。 |
| `pnpm test:scratch <ファイル.spec.cjs> --grep <ケース名・タグ>` | 指定した UI スクラッチケースだけを実行する。`--list` で対象を確認できる。 |

`pnpm test:windows` は、準備済みの `elevated` モードのサンドボックスと既存の `CODEX_HOME` を使う。準備不足で実行できない場合は成功扱いにせず、書き込み先は新規作業領域に限定する。

`pnpm test:external` で使う Pi 拡張の導入先は、次の優先順位で選ぶ。

1. `NERITA_EXTERNAL_AGENT_DIR`
2. `PI_CODING_AGENT_DIR`
3. ホーム内の `.pi/agent`

Web 拡張の検証では公開 GitHub リポジトリを取得し、未導入や通信失敗を成功扱いにしない。

## UI レビューの成果物

スクリーンショットの撮影とエラー収集には、対象テストシナリオ内で Playwright の API を使う。VS Code 上の Webview の画像・トレースと、明暗テーマでの表示幅・背景色・文字色は `dist/ui-review/nerita-distribution-*/` 配下へ実行ごとに保存する。

表示幅が狭い状態で、テーマの適用と操作ボタンの表示を確認する。現在の受け入れ検証では動画や HTML レポートを生成しない。

トレースは次の形式で開ける。

```sh
pnpm exec playwright show-trace <今回の成果物ディレクトリ>/trace.zip
```

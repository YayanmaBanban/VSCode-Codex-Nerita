# Pi 0.99.1 更新後の調査レポート

2026-09-30 時点の実装を、更新前の Pi 0.87.1 と比較した。依存定義、SDK の配布変換、Extension Host のセッション処理、共有状態、関連テストを調査した。比較対象はコミット `e08719d` とその親であり、既存の作業ツリーの変更は対象外とした。

既存機能の型チェック、Host テスト、配布関連テスト、同梱 SDK の会話テストは成功した。ただし、新しい入力受付結果と入れ子のツール履歴には対応を追加する価値がある。OpenAI の新しい ChatGPT 認証、MCP、コードによるツール実行は、バージョン更新だけでは Nerita に導入されない。

以下は修正前の調査結果であり、レビュー後の修正内容と検証結果は末尾に追記した。

## 修正と追加対応の優先順位

| 優先順位 | 対象 | 判断 |
| --- | --- | --- |
| 高 | 入力の受付結果 | `started`、`queued`、`handled` を区別する。現在は処理済みの入力も通常の会話入力として表示する。 |
| 中 | 入れ子のツール履歴 | 実行中と履歴再表示で表示内容が異なる。親子関係と保存された要約を扱う。 |
| 中 | 更新検証スクリプト | PowerShell 7 がないと、ビルドと会話テストの成功後に失敗する。事前確認または代替手段を追加する。 |
| 中 | Node.js の最低バージョン | 開発用の宣言を、上流の要求する `>=22.19.0` に合わせる。 |
| 機能追加 | OpenAI の ChatGPT 認証 | 配布対象のプロバイダーと OAuth の読み込み処理を拡張する。 |
| 機能追加 | MCP とコードによるツール実行 | SDK 用の起動処理、承認、設定、配布資産をまとめて設計する。 |
| 後続 | 構造化されたツール結果 | 本文がない結果も表示できるようにする。 |

## 入力の受付結果

対象は `apps/vscode-nerita/src/extension/backends/pi/PiRun.ts:165` と `PiRun.ts:302`。

Pi 0.99.1 の `prompt` は受付コールバックへ `started`、`queued`、`handled` を渡す。`steer` は `queued` または `handled` を返す。`handled` は、拡張の入力処理が入力を引き受け、通常の送信やキューへの追加をしなかったことを表す。

現在の `prompt` 側は `if (accepted)` で判定するため、すべての文字列を同じ受付結果として扱う。`steer` 側も戻り値を読み取らず、ユーザー本文と `prompt/accepted` を追加する。入力処理を行う信頼済み拡張を使用した場合、Nerita に表示した入力が SDK の会話履歴には存在しない場合がある。

実 SDK に `input` ハンドラーを登録し、`{ action: "handled" }` を返す確認では、次の結果になった。

```json
{
  "preflight": [{ "result": "handled", "truthy": true }],
  "steer": "handled",
  "queued": [],
  "messageCount": 0
}
```

通常送信、追加指示のキュー登録、拡張による処理済みを明示的に分岐することを推奨する。処理済みの場合も下書きを解放するかどうかは、拡張入力の仕様として決める。下書きの解放と、通常の会話履歴への追加を同じ条件にしない。

`tests/unit/piHarness.ts` と `piSteer.test.ts` は戻り値の型には更新されているが、主に `queued` を返す。`handled` の開始入力と追加指示、処理済み入力の直後に実行が終了するケースを検証へ追加するとよい。

## 入れ子のツール履歴

対象は次のファイル。

- `apps/vscode-nerita/src/extension/backends/pi/PiToolMapper.ts:27`
- 同じディレクトリの `PiHistoryMapper.ts:57`
- `packages/shared/src/chatState.ts`

SDK の `ctx.executeTool()` が別のツールを呼ぶと、実行通知に `parentToolCallId` が付く。子の呼び出しは通常の会話メッセージには追加されず、親ツールの結果に `nestedCalls` として要約が保存される。

現在の通知変換は子の呼び出しも独立したカードへ変換するが、親の ID を共有状態へ渡さない。履歴変換は `nestedCalls` を読み取らない。このため、信頼済み拡張が入れ子実行を使うと、実行中は子カードが見えても、履歴を開き直すと親カードだけになる。

既存の通知変換と履歴変換へ SDK の形式に合わせた入力を渡した結果は、次のとおりだった。これは変換関数の確認であり、実拡張からの入れ子実行全体を検証したものではない。

```json
{
  "liveTools": ["outer", "outer/1"],
  "restoredTools": ["outer"]
}
```

親子関係を共有状態へ追加し、実行中のカードと履歴の要約を同じ規則で表示することを推奨する。ただし `nestedCalls` は件数と入力サイズに上限があり、子の結果本文を保存しない。復元時は保存された名前、入力、状態の要約を表示し、完全な結果本文が復元できると扱わない。`complete: false` の記録も考慮する。

入れ子実行自体の承認は、SDK の呼び出し経路と `PiApprovedTools.ts` のラッパーを確認したうえで検証する。今回、承認を迂回する不具合は確認していない。

## 更新検証スクリプト

対象は `config/verify-pi.cjs:28` と `config/verify-pi.cjs:42`。

`pi:verify` は型チェック、Host テスト、配布関連テスト、VSIX 作成、会話テストを実行した後、`pwsh` を固定指定して VSIX を展開する。今回の環境では PowerShell 7 が PATH に存在せず、`spawnSync pwsh ENOENT` で失敗した。Windows PowerShell は存在していた。

必要なコマンドを検証開始時に確認して早く失敗させるか、展開方法を PowerShell 7 の有無に依存させないことを推奨する。今回、`tar.exe` で新しく作成した一時ディレクトリへ同じ VSIX を展開し、展開後の `tests/pi-chat-smoke.mjs` を実行すると成功した。

標準の `pi:verify` 自体は成功していない。展開後の検証を別の手段で補完した結果として扱う。

## Node.js の最低バージョン

対象はルート `package.json:6`。上流の `@earendil-works/pi-coding-agent` 0.99.1 は `node >=22.19.0` を要求するが、ルートの宣言は `>=22` になっている。

宣言を `>=22.19.0` に合わせることを推奨する。今回の開発用 Node.js は 24.18.1 であり、この差による実行失敗は起きていない。VS Code 内の Extension Host は別の Node.js で動くため、開発用 Node.js の結果だけでは対応できると判断しない。実 Extension Host の実行は今回の検証対象に含めていない。

## OpenAI の ChatGPT 認証

対象は次のファイル。

- `config/pi-bundle-plugin.cjs:22` と同ファイルの93行目
- `apps/vscode-nerita/src/extension/backends/pi/PiProviders.ts:9`

上流では `openai` プロバイダーへ ChatGPT 認証が追加され、`openai-codex` は旧方式として位置付けられた。一方、Nerita の配布カタログは `openai-codex`、`anthropic`、`google` の3つだけを生成する。OAuth の読み込み処理も Anthropic と旧 Codex の2つへ置き換えている。

生の SDK と配布済み SDK を比較し、生の SDK に `openai` がある一方、配布済み SDK には上記3つだけがあることを確認した。Nerita の認証 UI はプロバイダーの認証能力から項目を作るため、現在は新しい OpenAI のログイン項目が現れない。これは配布対象を絞った既存の設計による制約であり、既存の Codex 認証が壊れたという指摘ではない。

対応する場合は、`openaiProvider` と `loadOpenAIChatGPTOAuth` を配布へ追加し、配布物だけで OAuth の読み込みが解決することを検証する。プロバイダーだけ追加すると、OAuth の関数を独自変換が削除しているため、それだけでは対応が完了しない。

Fast mode、Ultra、モデルの補助カタログ、利用枠は現在 `openai-codex` 向けに登録されている。新しい `openai` へ同じ条件分岐をコピーせず、新しい認証方式と API の能力を確認して必要な処理を追加することを推奨する。

## MCP とコードによるツール実行

対象は次のファイル。

- `apps/vscode-nerita/src/extension/backends/pi/PiResources.ts:52`
- 同じディレクトリの `PiBuiltinExtensions.ts` と `PiRuntime.ts:344`
- `config/runtime/pi-entry.mjs`
- `config/package-pi.cjs`

上流では MCP、`codemode`、`tool_search` が組み込み拡張として追加された。しかし、Nerita は独自の `DefaultResourceLoader` へ `noExtensions: true` を渡し、明示的に信頼した拡張と Nerita の要求制御用の拡張だけを注入する。SDK の組み込み拡張は、単に `createAgentSession` を呼ぶだけでは注入されない。

また `PiRuntime.ts:352` は利用するツール名を明示指定する。ユーザーが Pi の設定へ `defaultTools: ["+codemode"]` を書いても、Nerita の公開ツール一覧には反映されない。依存ツリーに `pi-mcp` と `pi-codemode` が入ったことを、Host で利用可能になったことと同一視しない。

機能を追加する場合は、次をまとめて検討する。

- 必要な組み込み拡張を SDK 用に注入し、公開するツールを明示する。
- ユーザーとワークスペースの `mcp.json`、信頼状態、サーバーの起動と停止を Host 側へ接続する。
- MCP の各操作と入れ子のツール実行を、既存の承認と停止の処理へ通す。
- QuickJS の WASM、ワーカー、動的な読み込みを、展開した VSIX だけで実行できるか検証する。
- 前述した親子ツールの通知と履歴を扱う。

現在の `noExtensions: true` を取り除くだけでは、明示的に信頼したコードだけを読み込む既存の方針が変わる。SDK 用の組み込み拡張の追加と、ワークスペースの自動発見を分けて実装することを推奨する。

## 構造化されたツール結果

対象は `apps/vscode-nerita/src/extension/backends/pi/PiToolMapper.ts:8`。

現在のカードは `result.content` の本文と画像の説明だけを取り出す。新しいツールが `structuredContent` を中心に結果を返す場合、構造化データは表示されない。変換関数へ `content: []` と `structuredContent: { count: 3 }` を渡す確認では、カードの本文は空になった。

本文がない場合に限り、表示する項目とサイズを制限した構造化結果の表示を補うことを推奨する。`outputSchema` を表示の検証に使う場合も、認証値や大きなデータをそのままカードへ公開しない。現在の既存ツールが壊れたことは確認しておらず、MCP と新しい拡張への対応候補として扱う。

## 現時点で変更不要または後続に回す箇所

依存バージョンはルート、拡張機能、ロックファイル、`config/pi-version.json` で 0.99.1 に揃っている。配布用ソースのハッシュとライセンスの配置も更新され、配布関連テストは成功した。更新直後にすべての独自変換を削除する根拠はない。

GPT 6.1 Sol は配布済み SDK の `openai-codex` カタログに存在し、推論候補の取得も成功した。新モデルを列挙へ手動追加する必要はない。SDK の既定モデル変更を理由に、ユーザーが保存した選択モデルを上書きすることも推奨しない。

モデルの画像生成、分類、仮想モデルへの対応は後続の機能として検討できる。ただし、会話モデル向けの `getAvailableSnapshot()` や `getModels()` は上流でも維持されている。会話のモデル選択を一括して `getAllAvailable()` に変えると、画像用・分類用モデルまで通常の会話候補に混ざるため、操作別の設計が必要になる。今回、これらを必須の更新箇所とは判断していない。

既存のファイル操作、Shell、サブエージェント、ワークフローの承認と停止の仕組みは維持する。上流の新しいツールへ置換する場合も、Nerita が持つ権限制限を引き継げることを確認してから進める。

## 検証結果と未確認事項

- `pnpm check`：成功。Lint、Host と UI の型、テストの型を確認した。
- `pnpm test:host`：97ファイル、685件が成功。
- `pnpm test:runtime`：19件が成功。
- `pnpm package:vsix`：成功。
- `pnpm test:pi:chat`：成功。ローカルの模擬応答で、送信、追加指示、承認、停止、履歴、パッケージ読み込みなどを確認した。
- 展開した VSIX に対する `tests/pi-chat-smoke.mjs`：成功。標準の展開処理が失敗したため、`tar.exe` による展開で補完した。
- `pi:verify` 全体：失敗。原因は `pwsh` の欠落。
- 追加確認：実 SDK の `handled`、配布プロバイダーの差、配布カタログの新モデル、通知と履歴の変換、構造化結果の変換を確認した。

実サービスへの OAuth、実モデルへの送信、実 Extension Host、ブラウザーでの UI 操作、新しい MCP と QuickJS の実行は未確認。会話テストの成功をこれらの成功として扱わない。

依存グラフ MCP には対象リポジトリが登録されていなかったため、Git の差分、検索、実ソースと関連テストで調査した。

## 根拠

- 同梱パッケージの `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`。
- 同パッケージの `dist/core/agent-session.js` と `dist/core/extensions/types.d.ts`。
- 同パッケージの `dist/core/resource-loader.js` と `package.json`。
- 同じ依存ツリー内の `pi-ai` のプロバイダー、OAuth の読み込み処理、入れ子呼び出しの型。
- [Pi 0.99.1 の公式リリース](https://github.com/earendil-works/pi/releases/tag/v0.99.1)。
- [Pi 0.99.1 時点の変更履歴](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md)。

実装順序としては、入力受付の分岐、更新検証の環境依存、入れ子履歴を先に対応し、その後に OpenAI の新しい認証方式や MCP の追加を検討することを推奨する。

## レビュー後の修正（2026-09-30）

優先度が高・中の4項目を修正した。

- 入力受付は `started`、`queued`、`handled` を区別する。拡張が処理した入力は下書きを解放するが、通常の会話本文へ追加しない。追加指示が処理された直後に元の実行が終了しても受付を通知する。停止と切断の競合では、古い入力を受付済みにしない。
- 入れ子ツールの通知では親の ID を保持し、カードに親の名前を表示する。保存された `nestedCalls` から子と孫の要約を復元し、結果本文が保存されていないことを明示する。省略された入力のサイズ、`complete: false`、未完了の記録も表示する。復元によってツールや承認を再実行しない。
- `pi:verify` の展開処理を `tar.exe` へ変更し、利用可否をビルド前に確認する。展開や後続の検証が失敗した場合も、この実行で作成した一時ディレクトリを削除する。
- 開発用 Node.js の最低バージョンを `>=22.19.0` に合わせた。

検証結果は次のとおり。

- `pnpm pi:verify`：全工程で成功。型・Lint、Host テスト693件、配布関連テスト20件、VSIX 作成、同梱 SDK と展開した VSIX の会話テストを含む。
- 実 SDK の会話テストへ、拡張が処理した開始入力と追加指示、子ツールの承認と拒否、保存ファイルの再読込を追加した。拒否された子は書き込まず、許可された子だけが書き込み、復元後は結果本文を持たない要約になることを確認した。
- `pnpm ui-review pi-tools`：4シナリオで成功。320px 幅の明暗テーマで、入れ子の親名、要約の開閉、省略・未完了、既存の読み取り・停止・継続会話を確認した。生成画像も開いて確認し、ブラウザーエラーはなかった。
- 変更した日本語コメントの textlint と、変更ファイルの整形を確認した。

UI の成果物は `dist/ui-review/` に保存した。変更前の比較用画像とレポートは `dist/ui-review-history/pi-0991-review-20260930/before/` に保存した。

OpenAI の新しい ChatGPT 認証、MCP とコードによるツール実行、構造化された結果の表示は機能追加・後続の候補として残す。認証方式や配布資産、承認と停止の接続をまとめて設計する必要があり、今回の4項目の修正には含めていない。実サービスへの認証・送信と、実 Extension Host の操作は引き続き未確認。

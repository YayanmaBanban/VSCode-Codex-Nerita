# Pi Provider Controls（Phase 8 / 8-1）

`ChatState.piProviderControls` に現在のprovider / modelId、SDKのthinkingLevel、reasoningOverride、effectiveReasoning、fastModeを公開する。SDKモデルや認証結果のオブジェクトは公開しない。

## 設定と要求

- Providerは認証済みの利用可能モデルから列挙する。Codex OAuthのModel候補はPiの実行定義とlive `visibility = list` の共通部分だけをpriority順で表示し、provider変更時もその先頭を使う。live `display_name` をそのまま表示し、staticの場合もprovider suffixは付けない。`supported_in_api = false` はOAuth候補の除外理由にしない。
- Codex OAuthの通常Reasoningはlive `supported_reasoning_levels` と `AgentSession.getAvailableThinkingLevels()` の共通部分だけを使い、`none` を `off` へ変換する。Off / MinimalをPiのaliasから補完しない。通常値は `setThinkingLevel()` へ渡す。その他のproviderはSDK標準候補を使う。
- Ultraはliveに `ultra` があり、適用可能な標準基底があるCodex Responsesモデルに限定する。基底は共通max、共通live default、最も高い共通標準値の順。別状態でultraを保持し、要求フックで `reasoning.effort = "ultra"` を送る。max対応だけではUltraを推測しない。
- Fast Modeはlive `service_tiers` に `priority` があるCodex Responsesモデルでのみ公開し、説明もlive metadataから取得する。ON時に `service_tier = "priority"` を追加する。通常推論・Ultraと独立し、OFF時はPiやユーザー拡張の要求を維持する。
- モデル変更はSDKの推論clampを使う。Ultra非対応モデルへの変更でoverrideを解除し、Fast Mode非対応providerへ変えたらOFFに戻す。対応モデル間はUltraを維持する。SDK内部から通常推論へ変えられた場合もoverrideを解除する。
- Ultra / Fast Modeは現在の接続だけで保持し、新規会話・履歴load / fork・再接続では初期値へ戻す。標準のmodel / thinkingLevel保存はPi SDKに任せる。

`DefaultResourceLoader.extensionFactories` から組み込み拡張を注入する。ユーザーの `.pi/extensions` を変更せず、他の要求フィールドを保持する。複数拡張の同一フィールドへの書込みはSDKの実行順に従う。

## Live model catalog

`PiModelCatalogService` はprovider registryの `createCatalog` へ取得を委譲する。Codex OAuthだけが固定HTTPS `/backend-api/codex/models` を利用する。`client_version` は同梱Codexの `src/extension/backends/codex/codex-app-server/version.json` から生成する。認証はQuotaと共通の `CodexOAuth` を通してPi SDKの `getAuth()` / `checkAuth()` へ委譲し、認証ファイルを直接読まない。

認証を含む5秒timeout、redirect禁止、展開後2MiBの本文上限を設ける。未知schema・不正JSON・HTTP失敗は同一accountで最後に成功したcatalogへ戻す。初回失敗では現在モデルを維持し、未確認のPi staticモデルへ候補を広げない。live未確認のReasoning選択・Ultra・Fastは公開しないが、現在モデルでのチャットを妨げない。

cacheはSession内メモリだけで保持する。認証操作で破棄し、account変更後は旧accountの結果を再利用しない。接続・再接続・履歴復元・モデル/provider変更・認証完了時に取得し、AbortSignalとsession確認で古い応答を破棄する。Model選択、Provider選択、認証後の復帰のすべてでHost側もoverlay済み候補を検証する。liveに存在するhiddenモデルは履歴から継続利用し、一覧には出さない。liveに存在しない旧モデルは利用可能な候補へ復帰する。

token・account ID・生HTTP本文を共有状態、ログ、エラーへ公開しない。Anthropic / Googleのlive catalog、モデル定義の合成、persistent等の未知effort、disk cacheは対象外。

## 利用枠

`PiQuotaService` は登録されたproviderの取得サービスを呼ぶ共通窓口。Codex固有の認証・取得・応答変換は `codex/CodexQuotaService.ts` に置く。Codex Responses + OAuthの場合のみ、Pi SDKの `getAuth()` で認証を解決し、固定URL `https://chatgpt.com/backend-api/wham/usage` へGETする。取得経路の参考は [Codex backend-client](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)。非公開APIなので、HTTP失敗・不正JSON・未知の形式・タイムアウトは利用枠なしとして扱い、送信を妨げない。

接続完了、設定・認証操作完了、ターン終了で取得する。定期pollingは行わない。10秒timeoutを設け、設定変更・切断・再接続時は旧取得を中断し、遅い応答を破棄する。OAuth tokenとアカウントIDはHostのリクエスト内だけで利用し、ログやWebviewへ渡さない。redirectは許可しない。

`rate_limit.primary_window / secondary_window` を時間幅・残率・リセット時刻へ正規化し、`ChatState.quota` に公開する。5時間枠は5h、7日間枠はWeekly。credits・追加のモデル別枠は残率とは異なる形式のため今回表示しない。

Provider / Model / Reasoning / Fast Modeは `settings.main`、利用枠は `status` に登録する。非対応providerにCodex固有項目を登録しない。Codex App ServerとPiの利用枠は、quota controlから既存のQuotaBarを使用する。バーは時間枠の最小残率を示し、5h / Weeklyとリセット時刻はツールチップにまとめる。

## Provider固有処理の配置

```text
pi/
├─ PiProvider.ts          # 設定・要求変換・利用枠の共通契約
├─ PiProviders.ts         # provider IDごとの生成関数の登録一覧
├─ PiProviderControls.ts  # 委譲と未登録providerの標準推論設定
├─ PiModelCatalogService.ts # catalog委譲・候補intersection・寿命管理
├─ PiQuotaService.ts      # 利用枠取得の委譲・取消・旧応答破棄
└─ codex/
   ├─ CodexProviderControls.ts  # Ultra・Fast Mode・UI候補・要求書換え
   ├─ CodexModelCatalogService.ts # OAuth catalog取得・account cache
   ├─ CodexModelCatalog.ts     # live応答の検証・正規化
   ├─ CodexOAuth.ts            # Quotaとcatalogの認証共通境界
   └─ CodexQuotaService.ts     # OAuth・ChatGPT endpoint・応答正規化
```

利用枠取得はPi SDK ExtensionではないHost側サービスなので、`pi/extensions/codex` ではなく `pi/codex` にまとめる。GeminiやClaudeの固有機能を追加する場合は、対応するフォルダと `PiProviders.ts` の登録を追加する。共通処理にprovider名のif/switchを追加しない。登録のないproviderはSDK標準のモデル・推論設定を使い、固有の追加項目や利用枠通信を行わない。

`PiModelOptions` はproviderが返した追加設定・推論候補を合成する。Controllerは現在公開されている設定IDだけを受け付ける。Quota Contributionは正規化済みの取得結果をQuotaBarへ渡し、provider名を判定しない。既存の共有状態にある `reasoningOverride` / `fastMode` は通信互換のため維持する。将来、別providerの新しい実効状態を公開する場合は共有型・検証も拡張する。

## 検証の境界

モデル変更時の表示保持は `PiProvider.quotaGroup(modelId)` でカスタマイズする。同じprovider・同じグループなら取得済み利用枠を維持して再取得し、異なるグループ・provider変更・認証操作ではクリアする。未定義ならモデルID単位で扱う。Codexは `CodexQuotaGroup.ts` でSparkを別グループ、Luna〜Astraを含む通常モデルを共通グループとする。これは表示保持の方針であり、実サービスの利用枠共有関係を検証したものではない。

単体テストは設定の独立性・候補・clamp・通信検証・旧会話拒否・取得失敗・旧応答破棄を確認する。`pnpm test:pi:chat` は同梱した実SDKと隔離した模擬モデルで、metadataからの候補生成、Ultra / Fast Modeの要求フック、project-local拡張との共存を確認する。`pi-provider-controls` と既存のContribution / Composer / QuotaのUIレビューで320px・明暗テーマ・操作・無効状態を確認する。

実VS Code Webview、実OAuthアカウントのusage endpoint、外部Codex / Anthropic / Googleへの送信はこの検証に含まれない。特にultraの外部サーバー受理とpriorityの実際の処理速度は未検証。

### Phase 8-1 検証記録（2026-09-22）

- `pnpm check`、`pnpm check-types:tools`、開発ビルド（`node esbuild.js`）成功。
- 単体テスト296件成功。追加した23件でparser、固定endpoint、timeout、本文上限、account cache、Hostの選択経路、hidden履歴、Reasoning intersection、Ultra基底、Fast解除、認証無効化、古い応答、Quota・送信との独立性を確認。
- `pnpm test:pi:chat` 成功。同梱実SDK、模擬OAuthとmock catalog、`setModel()`、Ultra / priority要求書換え、project-local Pi Extensionとの共存、Quota失敗時のcatalog保持を確認。実OAuthアカウントの `/codex/models` は未検証。
- `pnpm ui-review pi-provider-controls contributions composer-settings --workers=4` の6件成功。320px・明暗テーマでlive表示名、Spark非表示、Off / Minimal / Ultraの有無、Fastの有無、provider切替、hidden履歴を確認。console / page errorなし。生成画像を開いて変更前後を比較した。
- 変更前画像は `dist/ui-review-history/phase8-1-live-catalog/before/`、変更後は `dist/ui-review/test-results/` と `dist/ui-review/report/`。
- 共有UI部品の変更前に実行した広範囲の `contributions composer` は39件成功・14件失敗。失敗対象はChanges、Clipboard、Expand、Path paste、Referencesで、今回変更した設定表示とは別の操作。結果は `dist/ui-review-history/phase8-1-live-catalog/shared-before/` に保存し、対象外の不具合は変更していない。

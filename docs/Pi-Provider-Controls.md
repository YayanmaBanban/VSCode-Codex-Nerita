# Pi Provider Controls（Phase 8）

`ChatState.piProviderControls` に現在のprovider / modelId、SDKのthinkingLevel、reasoningOverride、effectiveReasoning、fastModeを公開する。SDKモデルや認証結果のオブジェクトは公開しない。

## 設定と要求

- Providerは認証済みの利用可能モデルから列挙し、切替先の先頭モデルを選ぶ。Model候補は現在のproviderで絞る。既存のprovider/model形式の設定値を維持する。
- 通常Reasoningは `AgentSession.getAvailableThinkingLevels()` を使う。このSDK APIが `thinkingLevelMap` とモデルmetadataを解釈するため、独自の固定候補を作らない。通常値は `setThinkingLevel()` に渡す。
- Ultraは `openai-codex` provider、`openai-codex-responses` API、標準max対応モデルに限定する。基底値をmaxにし、別状態にultraを保持してUIにはeffectiveReasoningを表示する。Notion仕様に従い、要求フックで `reasoning.effort = "ultra"` を送る。max対応はNerita側の表示条件であり、外部サーバーによるultra受理を証明するmetadataではない。
- Fast ModeはCodex Responsesモデルでのみ公開し、ON時に `service_tier = "priority"` を追加する。通常の推論変更・Ultraと独立。OFF時はNeritaによる上書きを行わず、Piやユーザー拡張の要求を維持する。
- モデル変更はSDKの推論clampを使う。Ultra非対応モデルへの変更でoverrideを解除し、Fast Mode非対応providerへ変えたらOFFに戻す。対応モデル間はUltraを維持する。SDK内部から通常推論へ変えられた場合もoverrideを解除する。
- Ultra / Fast Modeは現在の接続だけで保持し、新規会話・履歴load / fork・再接続では初期値へ戻す。標準のmodel / thinkingLevel保存はPi SDKに任せる。

`DefaultResourceLoader.extensionFactories` から組み込み拡張を注入する。ユーザーの `.pi/extensions` を変更せず、他の要求フィールドを保持する。複数拡張の同一フィールドへの書込みはSDKの実行順に従う。

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
├─ PiQuotaService.ts      # 利用枠取得の委譲・取消・旧応答破棄
└─ codex/
   ├─ CodexProviderControls.ts  # Ultra・Fast Mode・UI候補・要求書換え
   └─ CodexQuotaService.ts     # OAuth・ChatGPT endpoint・応答正規化
```

利用枠取得はPi SDK ExtensionではないHost側サービスなので、`pi/extensions/codex` ではなく `pi/codex` にまとめる。GeminiやClaudeの固有機能を追加する場合は、対応するフォルダと `PiProviders.ts` の登録を追加する。共通処理にprovider名のif/switchを追加しない。登録のないproviderはSDK標準のモデル・推論設定を使い、固有の追加項目や利用枠通信を行わない。

`PiModelOptions` はproviderが返した追加設定・推論候補を合成する。Controllerは現在公開されている設定IDだけを受け付ける。Quota Contributionは正規化済みの取得結果をQuotaBarへ渡し、provider名を判定しない。既存の共有状態にある `reasoningOverride` / `fastMode` は通信互換のため維持する。将来、別providerの新しい実効状態を公開する場合は共有型・検証も拡張する。

## 検証の境界

単体テストは設定の独立性・候補・clamp・通信検証・旧会話拒否・取得失敗・旧応答破棄を確認する。`pnpm test:pi:chat` は同梱した実SDKと隔離した模擬モデルで、metadataからの候補生成、Ultra / Fast Modeの要求フック、project-local拡張との共存を確認する。`pi-provider-controls` と既存のContribution / Composer / QuotaのUIレビューで320px・明暗テーマ・操作・無効状態を確認する。

実VS Code Webview、実OAuthアカウントのusage endpoint、外部Codex / Anthropic / Googleへの送信はこの検証に含まれない。特にultraの外部サーバー受理とpriorityの実際の処理速度は未検証。

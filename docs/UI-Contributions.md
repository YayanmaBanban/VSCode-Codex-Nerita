# UI Contribution基盤（Phase 7-1）

Hostが宣言した設定項目をWebviewが描画する。共有契約は `src/shared/uiContributions.ts`、通信検証は `uiContributionValidation.ts` に置く。任意のReact Component・JavaScript・CSSは渡さない。

## 登録と表示条件

`SessionState` はセッションごとに `UiContributionRegistry` を所有する。内部実装は `uiRegistry.registerUiContribution(id, source)` で登録でき、戻り値の関数で解除できる。sourceは現在のChatStateとContributionContextから宣言を生成する。登録・解除後は次の状態更新またはsnapshotで再評価する。

```typescript
this.uiRegistry.registerUiContribution("nerita.example", (state) => [
	{
		id: "example.quota",
		slot: "status",
		order: 10,
		when: { backend: "pi", provider: "openai-codex", capability: "quota" },
		control: { type: "progress", label: "5h", value: 68 },
	},
]);
```

`when` はbackend・provider・capabilityのAND条件。未指定は制限なし、未知のprovider・capabilityは不一致。条件はHostで解決して除去し、Webviewへは `ChatState.uiContributions` のsurfaceとitemsのみを渡す。順序はorder、同値ならID順。重複登録名・重複表示ID・不正な宣言は拒否する。

Codexの文脈はbackend=`codex`、provider=`openai-codex`。Piはbackend=`pi`、providerは実SDKの現在の `session.model.provider`。capabilityはHostが公開している設定ID。利用枠は対応providerの取得結果がある場合にだけHostで登録する。

## controlとslot

初期controlはselect・toggle・progress。selectはConfigOption、toggleはconfigId・onValue・offValue、progressは0〜100の表示値を持つ。操作は既存の `config/set` を使い、要求ID・会話ID・候補値・実行状態は既存backendで検証する。新しい操作項目を登録する場合は、対応するbackendの処理も追加する。Registryへの登録だけで任意のHost処理は実行できない。

`model.header` はモデル設定の上、`composer.toolbar` は添付・使用量の後、`settings.main` / `settings.advanced` はbackend別Surface内、`status` は設定の後に配置する。各slotは汎用Rendererだけを使い、provider名で分岐しない。認証は既存Headerで扱う。

`builtinContributions.ts` がConfigOptionを宣言へ変換する。CodexのFast modeとservice tierの別名はHostで一つのtoggleにまとめる。Piは公開済みの設定だけを表示する。Phase 8で両backendのQuotaをquota controlとしてstatusへ統合し、既存のQuotaBarで描画する。バーは最小残率、ツールチップは全時間枠の詳細を表示する。Codex・PiともContribution経由に統一し、toggleは汎用のToggleSwitchで描画する。`uiContributions: null` はHostの定義を受信する前を表し、設定項目は描画しない。実Hostは初回snapshot・差分・リセット後も解決済み定義を公開し、StoryのBridgeも同じRegistryで宣言を生成する。

## Pi組み込みExtension

`PiBuiltinExtensions.ts` の `neritaExtensionFactories()` を `DefaultResourceLoader.extensionFactories` に渡す。名前は `nerita-provider-controls`。ユーザーの `.pi/extensions` やパッケージ探索、登録ツールの承認処理は維持する。workspaceへ組み込みExtensionのファイルを生成しない。

Phase 8ではセッションごとの `PiProviderControls` を注入し、`before_provider_request` でUltra・Fast Modeを適用する。詳細と検証範囲は [Pi Provider Controls](Pi-Provider-Controls.md) を参照。外部拡張向け公開API、button/badge/text、任意React injectionは未対応。

## 確認

- `pnpm test:unit`：条件の組合せ、安定順序、登録解除、通信検証、Codex別名、Piの再接続・無効化。
- `pnpm test:pi:chat`：配布SDKで組み込み・project-local・package拡張を同時に読み込み、ユーザー拡張の要求変更とツール承認を維持。
- `pnpm ui-review contributions composer-settings`：Codex App Server / Pi Codex / Anthropic / Google / Localの表示、select・toggle操作、provider切替、実行中・切断時の無効化、320pxの明暗テーマ。追加項目とQuotaの数値はStory専用の例。

Storybookの検証は実VS Code Webview・外部providerへの通信検証とは別に扱う。

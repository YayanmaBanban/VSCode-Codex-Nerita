# 型境界・責務・依存関係のコードレビューレポート

レビュー日: 2026-10-07。対象コミット: `4537aa8e7e83f960df6bb5d0a53c0e0b64cba448`。

修正確認日: 2026-10-07。R1〜R8 は対応済み。R8 は機能別の継承を協調オブジェクトへ置き換え、通知・初期化・接続回収の順序を明示した。継続する設計条件を末尾に記録した。以下の再現結果・行番号・評価表は初回レビュー時点のもの。

## 判定と対象範囲

**修正対象の不具合2件と、設計・保守性の改善候補6件を確認した。** 優先するのは、通信ガードが宣言型を保証できていない点と、伏字処理が型を保持するという契約に反して値の構造を変える点である。

対象は `packages/shared/src/`、`apps/nerita-ui/src/`、`apps/vscode-nerita/src/extension/` の製品コード。自動生成された `codex-app-server/` を除く TypeScript・TSX 471ファイルを走査した。内訳は共有パッケージ55、UI 152、Extension Host 264ファイル。検証処理・型アサーション・依存・責務の候補と利用側を精読し、関連する製品テストと設定も確認した。全ファイルの全行を手動で精読したという評価ではない。

コードレビュー用の依存グラフには登録リポジトリがなかったため、実ソースと TypeScript AST から調査した。初回レビューでは製品ソースを変更せず、以下の指摘を継続作業の記録とした。

優先度は、P2 を「再現できた不具合」、P3 を「現在の不具合を実証していない設計・保守性の改善候補」とする。

## 8項目の評価

| 項目 | 評価 | 根拠・対応する指摘 |
| --- | --- | --- |
| 1. `unknown` / `Record<string, unknown>` の伝播 | 改善が必要 | 正規化したツール本文も `unknown[]` で共有・描画へ渡る。Codex の解析結果にも具体化されていない `Record` が残る。R3・R4 |
| 2. 型ガードによる具体型への絞り込み | 修正・改善が必要 | Host 状態のガードは任意フィールドを検証せず具体型を保証する。フォーム項目のガードは検証した判別子を型に残さない。R1・R4 |
| 3. 同じ責務の重複 | 局所的な重複あり | ブリッジの生成・検証・購読解除を7つの関数で繰り返す。R5。機械的なクローン検出は0件 |
| 4. 関数・クラスの複数責務 | 分離候補あり | `PiAccount` がモデル選択・保存と認証対話・秘密値保護を所有する。R6 |
| 5. 共有パッケージ / UI / Extension Host の依存方向 | 方向は適切、配置に改善余地 | 禁止された直接インポートは検出していない。Host 専用コンパイラーが共有パッケージにある。R7 |
| 6. 型アサーションによる検証の回避 | 修正が必要 | 伏字処理2箇所の `as T` が実際の型変更を隠す。R2 |
| 7. 防御的なコードの必要性 | 必要な防御が多い、一部整理可能 | 非同期処理の取り消し・信頼の再検査は必要。内部 DTO を具体化すると識別子の再検査を整理でき、初期化後の API の条件付き呼び出しも不要になる。R4・R5 |
| 8. 過剰な抽象化 | 見直し候補あり | 任意の `T` を保持する伏字契約と、機能分割を継承で表した Codex の9つの抽象クラス。R2・R8 |

## 指摘

### R1 — P2: Host の型ガードが未検証の任意フィールドを具体型として受理する

根拠: [stateFieldValidation.ts](../../packages/shared/src/stateFieldValidation.ts) 87–122行、[chatState.ts](../../packages/shared/src/chatState.ts) 34–81行。

`messages` の検証処理は `references` と `order` を検証しない。`tools` でも `cwd`、`backgrounded`、`order`、`runId` が未検証である。これらは未知の追加キーではなく、既存の具体型に宣言されたフィールドである。

[受信メッセージの型ガード](../../packages/shared/src/hostMessageValidation.ts) と [状態の型ガード](../../packages/shared/src/stateValidation.ts) はこの検証結果を使う。それぞれ `HostMessage`・`ChatState` への絞り込みを約束するため、不正な値が具体型を持ったまま UI へ渡る。

本番のガードへ次を渡し、両方が `true` になることを確認した。

```js
{ type: "state/patch", revision: 1,
  patch: { messages: [{ id: "message", role: "user", text: "hello",
                       references: null, order: "wrong" }] } }

{ type: "state/patch", revision: 1,
  patch: { tools: [{ id: "tool", title: "tool", status: "completed", paths: [],
                    cwd: 42, backgrounded: "wrong", runId: {}, order: "wrong" }] } }
```

不正なメッセージはスナップショット、不正なツールは `toolUpdates` 経由でも受理された。`references: null` は [MessageText.tsx](../../apps/nerita-ui/src/chat/messages/MessageText.tsx) 89–95行から [messageReferences.ts](../../apps/nerita-ui/src/chat/messages/messageReferences.ts) 69行へ渡される。同じ描画用関数を呼び出し、`Cannot read properties of null (reading 'length')` を再現した。ブラウザー全体での画面停止は今回試験していない。

**影響:** 不正な Host 通知を受けたときに、境界で拒否するという契約が成立せず、描画時の例外や表示順の不整合につながる。通常の型付き Host がこれらの不正値を生成することまでは実証していない。

**修正方針:** 宣言済み任意フィールドも、存在する場合は全て検証する。`references` には既存の `validReferences(item.text, item.references)` を利用できる。型と検証処理の定義を対応させ、フィールド追加時の検証漏れを検出する。既存の未知キー・元参照の保持契約は維持する。

### R2 — P2: 伏字処理の `as T` が型と判別子の変更を隠す

根拠: [PiFeatureSafety.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureSafety.ts) 8–46行、[CredentialStore.ts](../../apps/vscode-nerita/src/extension/credentials/CredentialStore.ts) 95–104行。

`privateFeatureValue<T>()` と `SecretRedactor.value<T>()` は JSON への変換と復元の後に `as T` を適用している。どちらも `no-unsafe-type-assertion` を無効化しているが、入力を自身でシリアライズしても、変換後の構造が `T` を満たす保証にはならない。

ローカル検証で次を確認した。

| 入力・条件 | 実際の結果 | 契約との不一致 |
| --- | --- | --- |
| `privateFeatureValue({ details: { tokenCount: 42 } })` | `tokenCount` が `"[非公開]"` になる | 数値が文字列になる |
| `privateFeatureValue({ details: { headers: { count: 1 } } })` | `headers` が `"[非公開]"` になる | オブジェクトが文字列になる |
| `new SecretRedactor().value({ createdAt: new Date(...) })` | `createdAt` が文字列になる | 公開された汎用契約の `Date` が保持されない |
| 合成の秘密値 `"text"` を登録して `{ content: [{ type: "text", text: "visible result" }] }` を保護 | `type` が `"[REDACTED]"` になる | SDK の本文判別子が壊れる |

最後の結果を本番の [Pi 結果の表示処理](../../apps/vscode-nerita/src/extension/backends/pi/results/PiResultDisplay.ts) に渡すと、本文は `{ content: [] }` になった。実際の認証値は使っていない。`Date` の例は汎用型の保証を反証するものであり、現在の SDK が `Date` を渡すという主張ではない。

利用側は [PiFeatureToolResults.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureToolResults.ts) 23–47行、[PiRuntime.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime.ts) 653–661行・855–863行、認証通知では [PiAccount.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiAccount.ts) 318–319行。`PiToolFeatures.protect` と `PiSession.protect` にも、任意の `T` を維持する契約が広がっている。

**影響:** 条件に合う秘密値やキーがあると、伏字化で変更した値を元の型として扱い、本文が消えるなどの後段の不整合を起こす。秘密値の流出を再現した指摘ではない。

**修正方針:** SDK の判別子・ID・状態を保持し、本文や任意の `details` など、保護対象のデータを専用の変換で処理する。任意データには JSON 値などの入出力型を定め、形が変わる結果を無条件に `T` として返さない。必要な具体契約は変換後にも検証する。秘密値が契約フィールドに含まれる場合は、型を偽って変更する代わりに、契約を満たす非公開用の表示・通知へ変換する。

### R3 — P3: 正規化済みツール本文まで `unknown` が共有・描画境界を越える

根拠は次の4箇所。

- [chatState.ts](../../packages/shared/src/chatState.ts) 70–81行
- [activityItems.ts](../../apps/vscode-nerita/src/extension/backends/codex/items/activityItems.ts) 6–8行・143行
- [PiResultDisplay.ts](../../apps/vscode-nerita/src/extension/backends/pi/results/PiResultDisplay.ts) 157–158行
- [ToolContent.tsx](../../apps/nerita-ui/src/chat/tools/ToolContent.tsx) 48–110行

Host は本文を `content/text`、`diff`、`unifiedDiff` などの構造へ変換している。共有契約は `ToolSummary.content?: unknown[]` のままなので、UI は `isRecord` と `typeof` で構造を再解釈する。[推論カード](../../apps/nerita-ui/src/chat/tools/ActivityToolContent.tsx) 28–33行にも本文の取り出しがある。既知の形式の追加・変更を型チェックが両側へ伝えられない。

`rawInput`・`rawOutput`・`rawItem` も `unknown` で共有される。[Web 検索カード](../../apps/nerita-ui/src/chat/tools/ActivityToolContent.tsx) 92–97行や [実行カード](../../apps/nerita-ui/src/chat/tools/ToolContent.tsx) 192–196行が、バックエンド固有の `action`・`formatted_output` を読む。生データが単なる診断表示を越えて描画仕様を担っている。

**影響:** 型境界が描画側まで広がり、Host と UI の解釈がずれてもコンパイル時に検出しにくい。現在の正常入力での表示不具合は、この指摘単独では実証していない。

**改善方針:** 既知の本文を shared の判別共用体として定義し、Host で具体型へ変換する。検索語・コマンド出力など、専用表示に必要な情報も DTO に含める。未知の外部ツールの診断表示は専用の生データ・整形済みテキストとして残し、正常系の DTO と区別する。`unknown` を一律に `JsonValue` へ変えるだけでは、既知形式の解釈の重複は解消しない。

### R4 — P3: Codex の解析結果と一部ガードが、検証した構造を型に残さない

根拠: [turnEvents.ts](../../apps/vscode-nerita/src/extension/backends/codex/items/turnEvents.ts) 8–37行・83–114行、[history.ts](../../apps/vscode-nerita/src/extension/backends/codex/protocol/history.ts) 39–46行、[elicitation.ts](../../apps/vscode-nerita/src/extension/backends/codex/interaction/elicitation.ts) 88–103行。

`parseTurnEvent()` は解析後も `params`・`item` を `Record`、完了項目を `unknown[]` として返す。`id`・`type` は確認済みでも、その事実が戻り値の型に反映されない。利用側の [applyTurnEvent.ts](../../apps/vscode-nerita/src/extension/backends/codex/items/applyTurnEvent.ts) 106–112行は `id`・`type` を再検査する。[chatItems.ts](../../apps/vscode-nerita/src/extension/backends/codex/items/chatItems.ts) 51–64行にも構造確認がある。

ローカル検証では `turn/diff/updated` の `diff: 42` が解析処理を通り、`activityPatch()` の段階で初めて拒否された。後段の検証は機能しているが、解析後の契約を具体化する責任が分散している。

`supportedField()` も項目種別を4種類に制限しながら、戻り値は `field is Record<string, unknown>` だけである。`fieldValue()` は、その後も `type: unknown` を受け取る。[活動の識別情報の型ガード](../../apps/vscode-nerita/src/extension/backends/codex/items/agentItems.ts) 148–165行も、検証した `kind` を絞り込み後の型に含めない。`isPermissionPresentation()` の戻り値は `boolean` で、単独利用時に具体型へ狭められない。現在の複合的な検証処理内での使い方では、不具合を示さない。

**改善方針:** 対応する通知・項目を、検証済みフィールドを持つ内部の判別共用体へ変換する。フォーム項目も必要な制約を検証して `SupportedField` へ狭める。未知の通知・JSON Schema 全体・外部ツールの任意引数まで、無理に固定型へ限定する必要はない。

**防御の整理条件:** 現在の `Record` 型のまま後段の検証を削除するのは不適切。具体型を保証する解析処理へ変更してから、同じ識別子の再検査を整理する。

### R5 — P3: ブリッジ生成と購読処理が7箇所に重複し、初期化済み API も条件付きで呼び出す

根拠: [vscodeBridge.ts](../../apps/nerita-ui/src/bridge/vscodeBridge.ts) 54・71・88・105・122・139・161行。

各生成関数が API の取得、送信、`message` イベント購読、受信検証、購読解除を繰り返す。6つは Zod の `safeParse()`、チャットは `isHostMessage()` を使うが、イベント購読の責務は同じである。

生成関数内で `api ??= acquireVsCodeApi()` が完了し、同ファイルに API を未設定へ戻す処理はない。それでも送信は `api?.postMessage()` なので、不要な条件分岐と、未設定なら通知せずに送信を省略する挙動が残る。

**改善方針:** 検証成功時の通知と購読解除だけを小さな共通関数にまとめる。初期化済みの API をローカル変数へ保持し、送信は直接呼び出す。チャットの元参照を保持する型ガードと、Zod の解析値を返す専用パネルの違いは維持する。新たなブリッジ基底クラスや登録フレームワークは不要である。

### R6 — P3: `PiAccount` がモデル設定と認証フローを同時に所有する

根拠: [PiAccount.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiAccount.ts) 60–205行・207–321行・357–431行。

同クラスが、モデル候補・推論レベルの復元、モデル選択・保存、認証操作 ID の解釈、ログインの保存方式と名前の対話、秘密値保護、認証アカウント一覧の組み立てを担当する。モデル選択の仕様変更と、認証・資格情報の保存仕様の変更が同じクラスへ集まる。

`PiModelCatalogService`・`PiProviderControls`・資格情報ストアは既に分離されているため、既存の協調関係を利用できる。400行を超えるという理由だけの指摘ではない。

**改善方針:** 認証操作・対話・一覧の組み立てを Pi 内の認証フローへ移す。`PiAccount` は認証成功後のカタログ更新とモデル再同期を調整する。認証とモデル状態が連動する処理自体は必要であり、そこまで無関係なサービスとして切り離さない。

### R7 — P3: Host 専用のワークフローコンパイラーが shared に置かれる

初回の配置は `packages/shared/src/workflows/compiler.ts` 10–46行。修正後の配置は [compiler.ts](../../apps/vscode-nerita/src/extension/backends/pi/workflows/compiler.ts)。製品の利用側は [PiWorkflowTool.ts](../../apps/vscode-nerita/src/extension/backends/pi/workflows/PiWorkflowTool.ts) と [WorkflowPanel.ts](../../apps/vscode-nerita/src/extension/backends/pi/workflows/WorkflowPanel.ts) だけ。

コンパイラーは Pi の実行用スクリプトを生成し、`runs.run()`、子の再開・フォーク、実行結果の扱いを知っている。UI と共有する通信型・定義の検証から、Host の実行方式へ責務が広がっている。Node API や Extension Host を共有パッケージから逆向きにインポートしているわけではない。

**改善方針:** コンパイラーは Extension Host の Pi ワークフロー用フォルダーへ配置する。UI と Host が必要とするワークフロー定義・検証・メッセージは共有パッケージに残す。これは依存方向の障害ではなく、実行責務の担当を明確にする改善である。

### R8 — P3: Codex の独立した機能を9つの抽象クラスの継承順で組み立てる

根拠: [CodexSessionController.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController.ts) 22行から、次の継承を辿る。

```text
SessionState
  → CodexLifecycle → CodexAttachments → CodexOptions → CodexRequests
  → CodexAgents → CodexRun → CodexCatalog → CodexHistory
  → CodexSubmission → CodexSessionController
```

Codex 内の中間9クラスは抽象クラスで、走査した製品コードでは各クラスを次の1クラスだけが継承する。添付・設定・承認・子・履歴は、型の派生関係というより機能の追加として並んでいる。

通知は `super` 経由で、履歴・ターン処理・子の管理・設定の各クラスを通る。該当箇所は [CodexHistory.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexHistory.ts) 31–42行、[CodexRun.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexRun.ts) 203–205行、[CodexAgents.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexAgents.ts) 19–33行、[CodexOptions.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexOptions.ts) 367行以降。[CodexCatalog.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexCatalog.ts) 21–29行は初期化の呼び出し方も切り替える。処理順と共有状態の更新を追うために、機能ごとに継承階層を往復する必要がある。

**改善方針:** 通知ルーティングとセッション状態の所有を明示し、添付・設定・履歴などを小さな協調オブジェクトか関数へ段階的に移す。巨大な単一クラスへの結合や、新しい汎用プラグイン基盤への置換は避ける。この構造が原因の実行時不具合は今回実証していない。

## 維持すべき境界と防御

- 外部 JSON、Webview の `MessageEvent<unknown>`、例外、動的な外部ツール引数は、入力時点で構造を保証できないため `unknown` で受ける。`isRecord()` も入口の外形確認として必要であり、存在だけを問題としない。
- TypeScript AST から解決した領域内・領域間の静的インポート・エクスポート1,838本を確認した。UI→Extension Host、Extension Host→UI、共有パッケージ→両アプリの禁止された参照は検出しなかった。共有パッケージの外部インポートは `zod`・`smol-toml` だった。
- 型専用参照を除いた静的グラフでは循環を検出しなかった。型専用参照を含めると `chatState` と `subAgents`、`PiRuntime` と協調モジュールなどに循環があるが、実行時の循環とは区別する。動的読込みや生成コードまで含む完全な実行時グラフの証明ではない。
- 受信ガードは適用前に具体型へ狭める構成である。特に Zod 定義から型を導出する宣言型 UI・専用パネルでは、検証と型定義が対応している。R1 はその構成内の検証漏れである。
- `as const` を除く `as` 式は10箇所を確認した。`as unknown`、配列の要素を `unknown` として扱う式、検証済み・型付きの内部値の調整を、R2 の無検証な `as T` と同じ問題として数えていない。`sdkSchema` の `z.custom` も、同梱 SDK のエクスポート存在確認という目的であり、関数を呼んだ結果まで検証するガードとは評価しない。
- [ApprovedToolCall.ts](../../apps/vscode-nerita/src/extension/security/ApprovedToolCall.ts) の固定・fingerprint・単回許可、[PiApprovedTools.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiApprovedTools.ts) の実行直前の trust・取消の再検査は必要である。承認待ちの間に入力・信頼・中止状態が変わるため、事前確認と同じ条件でも削除すべきではない。
- `await` 後の世代・`signal.aborted` の再確認も必要である。`no-unnecessary-condition` の抑制だけから不要な防御とは判断しない。
- [セッションの受信処理](../../apps/vscode-nerita/src/extension/session/chatSession.ts) は現在 `unknown` を受ける公開入口である。Webview 側とコントローラー側に検証があることだけでは、後者を削除できない。型付きの内部呼び出し経路を別に設ける場合に限り、通常経路の再検証を整理できる。

## 検証と限界

| 検証 | 結果 |
| --- | --- |
| 不正な Host 状態の本番ガードと参照描画関数 | R1 を再現。`patch`・`snapshot`・`toolUpdates` の受理と、`null` 参照の例外を確認 |
| 本番の伏字処理と結果表示変換 | R2 を再現。型変更・判別子変更・本文の消失を確認 |
| Codex 通知の解析と活動変換 | R4 の検証責務の分散を確認。不正な `diff` は解析処理を通過した後に変換処理が拒否 |
| `pnpm test:product shared-schema pi-results credentials-store codex-conversation` | 26件成功、失敗・スキップなし |
| `pnpm duplication:ai` | 設定上のクローン0件。追加の集計結果で479ファイルの走査を確認。AST 走査との差は CSS・JSON 等を含むことによる |
| `pnpm check` | 成功。Lint、製品・UI・Storybook・テストの型チェック、基準ブランチとの差分の重複検査を完了。警告なし |

再現は本番モジュールをメモリー上でバンドルし、合成の入力を渡して行った。一時的な調査・再現スクリプトは確認後に削除した。既存のテストや期待値は変更していない。

クローン検出は8行・60トークン以上という設定であり、同じ責務を少し異なるコードで実装した R5 まで否定する結果ではない。既存26件の成功も、今回再現した未保護の入力を正しく拒否する証拠にはならない。

今回、実サービスでの認証、外部 MCP、VS Code 上の UI 操作、Windows サンドボックスの受け入れ検証は行っていない。関連テスト全体や生成プロトコルの完全な妥当性も保証しない。

## 対応順と確認条件

1. **R1:** 宣言済み任意フィールドの検証を補い、既存の `shared-schema` に不正な `references`・`order`・`cwd`・`runId` 等の拒否を追加する。`patch`・`snapshot`・`toolUpdates` に同じ契約を適用する。
2. **R2:** 伏字処理の具体契約を定め、判別子と状態を保護対象の本文から分離する。既存の資格情報・Pi 結果テストで、秘密値の非公開と、正常な本文・契約の維持を同時に確認する。
3. **R3・R4:** 正規化 DTO と具体的な解析結果の型を整え、その保証を前提に内部の重複した型検査を減らす。
4. **R5・R7:** 小さな範囲でブリッジの重複と実行コードの配置を整理する。通信値の検証・元参照保持・購読解除を維持する。
5. **R6・R8:** 関連機能を変更する際に段階的に責務を分ける。認証後のモデル再同期、通知順、接続世代、履歴復元、送信・停止の既存保護を維持する。

P3 の改善を実施するために、今回の正常経路を全体的に作り直す必要はない。具体型を保証する境界を先に修正し、その結果として不要になった分岐・抽象化を減らす。

## 継続する設計判断

R8 の機能別の継承は解消した。各機能は、必要な状態の取得関数と更新操作を受け取る協調オブジェクトになった。

| 担当する機能 | 実装 |
| --- | --- |
| 添付 | [CodexAttachments.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexAttachments.ts) |
| 一覧 | [CodexCatalog.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexCatalog.ts) |
| 子の管理 | [CodexAgents.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexAgents.ts) |
| 設定 | [CodexOptions.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexOptions.ts) |
| 履歴操作 | [CodexHistory.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexHistory.ts) |
| 承認と対話 | [CodexRequests.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexRequests.ts) |
| 送信 | [CodexSubmission.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexSubmission.ts) |
| ターン処理 | [CodexRun.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexRun.ts) |
| 接続処理 | [CodexLifecycle.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexLifecycle.ts) |

一覧はページ取得世代・カーソル・未反映のフォークを管理する。現在の会話とターンの解除はコントローラーへ委ね、各オブジェクトに別の会話状態を持たせない。

通知は [CodexSessionController.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController.ts) が、従来と同じ「履歴の競合処理 → 設定 → 子 → 親ターン → 一覧」の順で明示的に配信する。新規会話の初期化も「設定 → 接続世代の照合 → 一覧」の順でコントローラーが管理する。履歴復元は設定だけを初期化し、一覧のアーカイブフィルターを維持する。この違いを再び継承の呼び出し方へ埋め込まない。

親ターンの項目を子の管理へ渡すかの判定もコントローラーが担当する。開始応答前の親の活動はターン処理で待機・再生し、照合した項目だけを子の管理へ渡す。閲覧用の全文出力はコントローラーの通知経路で引き継ぎ、会話の切り替え後に届いた取得結果は公開せず破棄する。

子の管理へ渡す状態取得関数は内部値の元参照を維持する必要がある。子の取得中に通知で状態が更新されたかを、参照の同一性で判定している。公開用スナップショットのような複製へ変更すると、取得結果と通知の優先順位が変わる。

設定はモデル候補・次のターンの上書き値・協調モード・選択の保存を管理する。送信先と入力は保持せず、送信時点の設定を複製してターン処理へ渡す。ハンドオフのモデル選択と画像入力への対応の判定も同じ設定オブジェクトを参照する。

初期化は会話の切り替え後、操作待ちを維持したまま行い、新規会話だけ保存済みの選択を読み込む。履歴復元で保存済みの選択を書き換えず、Plan から新規会話へ移す際には書き込み先・ネットワーク・承認者も引き継ぐ。添付と対話のサービスはコントローラーが受け取り、設定の初期化や継承順に再び依存させない。

履歴操作は接続世代と操作オブジェクトの同一性で非同期処理を照合する。復元対象への開始・アーカイブ・削除通知は、操作前のスレッド確認から追跡し、古い確認応答で再開・フォークしない。全文出力は復元が確定するまで履歴操作側が保持し、取り消し・競合時には破棄する。確定後はコントローラーが本文と同時に引き取る。設定の初期化後にも同じ操作・接続・会話であることを確認してから子を同期する。

古い操作の後片付けで、新しい操作の待機状態や競合判定を解除しない。外部のアーカイブ・削除通知では会話の本文を残し、利用者が表示中の履歴をアーカイブ・削除した場合は本文も消す。どちらの場合も全文参照を失効させ、送信対象から外す。

現在のターン `active` は [CodexRun.ts](../../apps/vscode-nerita/src/extension/backends/codex/CodexRun.ts) が生成・更新・解除する。コントローラーは同じターン処理オブジェクトへ開始・停止・通知・会話変更時の解除を渡す。ターン処理は会話状態や接続を別に保持せず、停止の失敗・期限切れはコントローラーの接続終了経路へ通知する。

開始応答前の通知は対象ターンの確定後に到着順で適用し、先行する完了も同じ経路で確定する。停止要求は開始応答と開始通知の両方を待って一度だけ送り、停止応答を受けても完了通知までは停止待ちを維持する。

承認と対話は現在のターンの取得関数を受け取り、開始応答の待機前後で同一のターンであることを照合する。この取得関数は元のターンを返し、取得のたびに複製しない。接続世代の照合は接続処理が担当する。照合済みの要求の配信と、利用者が承認を中止したときのターン停止はコントローラーが担当する。

承認・対話オブジェクトは承認一覧と対話の直列化を管理し、サーバー要求とターンの取り消しに追従する。停止・完了・切断で消えた承認を新しいターンへ持ち越さず、停止後に届いた入力や待機中の質問の回答も返さない。

送信処理は参照・添付・ハンドオフの準備と追加指示の受け付けを管理する。ターンの開始・添付の読み取りはコントローラー経由で実行する。送信の待機と取り消しは接続世代・会話・操作オブジェクトごとに保持する。接続変更前に始まった読み取りが遅れて完了しても、その後片付けで新しい準備の待機を解除しない。

コントローラーは送信準備を取り消してからターンを停止する。準備中にターンが正常完了した場合は新規送信へ切り替えるが、明示的な停止・失敗の後には待機中の指示で再開しない。追加指示は準備後にも同じターンかを照合し、受け付けたか不明な場合は自動再送しない。MCP 一覧は会話への表示だけを更新し、モデルのターンを開始しない。

継承は `SessionState → CodexSessionController` のみになった。`SessionState` は会話状態・通知の購読・全文出力の共通基盤であり、機能の実行順を継承で組み立てる役割は持たせない。接続処理は接続・取り消し・世代・終了待ちを管理し、機能別の処理は同じ接続と世代の取得関数を共用する。

取り消された接続の生成結果が遅れて返っても、認証確認や会話開始へ進めず破棄する。前の接続の回収を待ってから次の接続を開始し、終了操作も起動待ちの接続の回収まで待つ。旧世代の通知・承認・切断通知は、新しい会話の ID が一致していても適用しない。

ログイン完了通知だけで会話を開始せず、同じ接続の認証状態を読み直して確認する。新規会話は確定後にコントローラーの設定・一覧初期化を待ち、完了まで送信を受け付けない。切断・再接続・会話変更時には、接続処理から同じターン処理へ解除を渡し、開始待ち・承認と対話・停止タイマーを解消する。

コントローラーの終了操作は、接続回収を開始した直後に UI の購読と全文出力を解除する。今後の変更でも状態を二重管理せず、接続の取り消し・世代の照合・履歴復元・送信・停止の担当テストで確認する。

Codex の項目は入口で `id` と `type` を保証するが、項目種別ごとの任意ペイロードは外部データのまま保持する。活動通知の本文は入口で具体化済みであり、項目固有の本文・ツール引数まで無検証で扱えるという保証ではない。項目種別の型を今後追加する場合は、その種別の解析処理と利用側を同時に変更してから後段の検査を減らす。

共有ツール本文は判別共用体を使用し、検索語とコマンド出力も専用フィールドで渡す。`rawInput`・`rawOutput`・`rawItem` は未知の外部ツールや診断のために維持する。コマンド全文は出力ストアへ退避した後、共有状態の `commandOutput` からも除く必要がある。新しい表示用フィールドを追加するときも、保存用の全文と配信用のプレビューの分離を守る。

汎用の伏字変換は元の型を保証せず、SDK 結果・保存メッセージ・認証通知はそれぞれの具体契約を維持して保護する。SDK の判別子や制御フィールドが増えた場合は専用変換の更新が必要になる。認証 URL や画像の契約値が秘密値の置換対象になる場合は、壊れた値を返さず非公開の本文・情報通知へ変換する。

R1〜R7 の修正時は `pnpm check` が成功し、製品テスト181件、関連ストーリー15件を確認した。最終差分で伏字処理の JSON 本文保護も確認し、関連する製品テスト31件を再実行して成功した。実サービスでの認証・外部 MCP・VS Code 上の Webview 操作は確認範囲に含めていない。

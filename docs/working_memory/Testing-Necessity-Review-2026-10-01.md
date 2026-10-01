# 721ケースの必要性と検出漏れの再監査

監査日: 2026-10-01。[初回の監査](Testing-Policy-Audit-2026-10-01.md)と同じ作業ツリーを対象とする。

**721ケースすべてに残す価値がある、とは判断できない。** 初回の「削除2件」は、アサーション群に対する指摘数だった。721ケースから不要なテストを選別した件数ではなく、必要性を評価する報告として不十分だった。

再監査では、Host 側の102ファイル・721ケースから、**削除12ケース、統合10ケース、修正15ケース**を特定した。さらに、3つの不具合を同時に注入しても721ケースすべてが成功した。成功件数を、そのまま回帰を検出する能力の証拠にはできない。

今回は対応方針のマークまでとし、製品コードと既存テストは変更していない。

## 母数と判定の意味

721は `config/vitest.host.config.ts` による実行時のケース数。`it.each` とループの展開を含む。静的なテスト定義の列挙数とは区別する。

| 判定 | ケース数 | 意味 |
| --- | ---: | --- |
| 削除 | 12 | 残る代表ケースと同じ契約・経路・観測結果を繰り返す |
| 統合 | 10 | 移管元と移管先を含む対象数。10ケースを無条件に削除する意味ではない |
| 修正 | 15 | 必要な境界を扱うが、条件や観測が不足する |
| 維持判定保留 | 684 | 静的な照合だけでは、独立した担当として残す根拠を確定していない |
| 合計 | 721 | 1ケースに1つの主な判定を付け、重複計上しない |

初回の R02–R05、R10–R11、M01 の対象も上表に含めた。UI、Node の補助ツール試験、VS Code の結合試験、受入スクリプトは721件の外にある。初回の D01–D02 や、Pi 承認 UI の32組も、この表へ加算していない。

[テストポリシー](../../.agents/docs/Testing-Policy.md)に従い、入力、呼出先、実装の分岐、アサーション、既存の担当を照合した。固定データを使うこと自体を削除理由にはしない。同じ入力でも実際の変換や接続を通り、その契約を壊したら失敗する検査には役割がある。

## 削除する12ケース

| ID | 対象と行 | 削除数 | 残す担当と削除理由 |
| --- | --- | ---: | --- |
| D03 | [piApprovedTools.test.ts](../../tests/unit/piApprovedTools.test.ts) 41行、`write`・`edit`・`powershell`・`bash` | 4 | `custom` の1ケースへ集約する。すべて同じ偽の `execute` を直接ラップするだけで、実ツールの登録や実行経路を通らない |
| D04 | [piQuota.test.ts](../../tests/unit/piQuota.test.ts) 147行、6行中の2・4・5行目 | 3 | 同一モデル・異なるモデル・異なるプロバイダーの3条件を残す。モデル名を変えて同じ不一致判定を繰り返している |
| D05 | [piPlatformTools.test.ts](../../tests/unit/piPlatformTools.test.ts) 97行 | 1 | `darwin` を削除し `linux` を残す。模擬した OS 名で同じ非 Windows 分岐を通る |
| D05 | [sandboxExecutor.test.ts](../../tests/unit/sandboxExecutor.test.ts) 78行 | 1 | 同上。非 Windows で接続・実行しない契約は残る |
| D05 | [sandboxSetup.test.ts](../../tests/unit/sandboxSetup.test.ts) 62行 | 1 | 同上。非 Windows でコマンドを登録しない契約は残る |
| D06 | [handoffContext.test.ts](../../tests/unit/handoffContext.test.ts) 107行、空文字 | 1 | 空白文字列のケースへ集約する。両方とも `!result.trim()` の同じ拒否を確認し、空白のケースは `trim()` の欠落も検出する |
| D07 | [sandboxSetup.test.ts](../../tests/unit/sandboxSetup.test.ts) 110行、`undefined` | 1 | `codex` の拒否を残す。モックが既定値を無視して返す `undefined` で、同じ `=== "pi"` の不成立を重ねている |

D03 の実装は [PiApprovedTools.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiApprovedTools.ts)。この準備条件では名前による処理の違いを通らない。実 SDK の書込みとシェルの配線は、既存の `piSandboxTools` と `piShellTools` が担当する。名前だけ変えた4ケースを残しても、その配線の破損は検出できない。

D04 の実装は [PiQuotaService.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiQuotaService.ts) の `canRetainForModel`。モデルごとの個別ルールはなく、現在の OpenAI 登録に `quotaGroup` はない。独自プロバイダーのグループ指定は同ファイル155行のケースを残す。

D05 は実 OS ごとの差を測る試験ではない。3ファイルは公開ツール、実行要求、コマンド登録という別の境界なので、それぞれ非 Windows の代表を残す。3ファイル全体を1ケースにまとめる判断ではない。

D06 の担当実装は [HandoffDeadline.ts](../../apps/vscode-nerita/src/extension/session/HandoffDeadline.ts)。D07 の実装は [sandboxSetup.ts](../../apps/vscode-nerita/src/extension/backends/codex/settings/sandboxSetup.ts)。設定の取得に渡す既定値は `codex` であり、現状の `undefined` ケースはその既定値の適用を検証していない。

## 統合する10ケース

| ID | 対象と行 | 対象数 | 統合後の担当 |
| --- | --- | ---: | --- |
| M03 | [modelEffort.test.ts](../../tests/unit/modelEffort.test.ts) 13行の2ケースと [codexSelection.test.ts](../../tests/unit/codexSelection.test.ts) 96行の2ケース | 4 | `codexSelection` にモデル切替時の推論量の維持・補正・保存・次の送信をまとめる |
| M04 | [piSubagentAdapter.test.ts](../../tests/unit/piSubagentAdapter.test.ts) 86行、`tasks`・`chain`・`workflowScript` | 3 | 同じ入力検証の担当へ集約し、必須項目不足と未知キー拒否を分離する |
| M01 | [piTools.test.ts](../../tests/unit/piTools.test.ts) 30行と [piHttpMcp.test.ts](../../tests/integration/piHttpMcp.test.ts) 176行 | 2 | 実 HTTP 結果から表示用の状態・保存・復元までを HTTP 結合試験へ移す |
| M05 | [piStorage.test.ts](../../tests/contract/piStorage.test.ts) 55行 | 1 | 保存先の衝突を、既存の保存・保存先切替の結合シナリオへ移す |

M03 は両方とも実際の Controller を通す。ファイルが違うことは別レイヤーの理由にならない。統合時は、対応する推論量の維持と、非対応の推論量の補正をそれぞれ残す。補正直後に送信し、画面・保存値・送信値を観測する。

現在の `codexSelection` は、モデル切替後に推論量を明示設定してから送る。この操作が、切替直後の送信値の不具合を隠す。`modelEffort` の送信検査を移してから、ファイルを削除する。

M04 の3入力はいずれもトップレベルの `agent` と `task` が欠ける。未知キーの拒否を壊しても、必須項目不足で成功し得る。必須項目不足は代表1ケースへまとめる。既存の `extra: true` は正常な必須項目を持つため、未知キー拒否の担当として使う。機能固有の拒否を主張する場合も、他の必須項目は正常にする。

M01 は初回指摘のうち、移管元と移管先をケース単位で明記したもの。`piResultDisplay` の秘密除去・予算・循環参照、履歴の同一 ID の分離などは、この2ケースへまとめない。それぞれ固有の失敗経路を持つ。

### M05 保存先の衝突を製品の保存経路で確認する

現在の検査は、任意のパスへ `keep` を書き、`preparePiSessionDirectory` の拒否と元の内容だけを確認する。実装の先頭にある `mkdir` が失敗するため、製品側の `.gitignore` の処理には到達しない。実際の保存先の選択や、SDK による会話の作成も通らない。

この検査でも、ヘルパー自身が例外を握りつぶしたり、衝突したファイルを消したりする変更は検出し得る。したがって、固定入力で一度成功したという理由だけで、価値が皆無とは判断しない。ただし、テスト名にある「別保存先への退避」は、呼出元の判断まで通して確認する必要がある。

[PiSessionStore.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiSessionStore.ts) の `openPiSessionStore` に、準備失敗時のグローバル保存先への切替を注入した。読込み時だけ変換し、適用ログも確認した。それでも `piStorage.test.ts` の3ケースはすべて成功した。通常実行も3ケース成功した。変異を適用した全スイートや受入本体は実行していない。

統合先は [pi-persistence-smoke.mjs](../../tests/pi-persistence-smoke.mjs) の保存先切替シナリオ。既存の Controller と実 SDK の経路に、保存先がファイルで塞がれている条件を取り込む。以下の結果を観測し、この変異で失敗するようにする。

- 衝突したファイルの内容を保持する。
- 保存先変更の失敗を呼出元へ通知し、モデルへの要求を送らない。
- グローバル側にも新しい会話を作成・追記しない。
- 切替前の会話と、失敗した送信の再試行に必要な状態を保持する。

`piSession.test.ts` の205行には保存先更新の失敗を模擬するケースがある。ただし、任意の例外をモックで返すため、実ファイルの衝突がその失敗へ接続される保証にはならない。統合先で実際の衝突と結果を確認した後、55行の独立ケースを削除する。集計の1件は721件内の移管元だけを数え、母数外の統合先は加算しない。

## 修正する15ケース

初回指摘の7ケースは、サイズ制限4ケース、通常ツール結果の結合1ケース、HTTP MCP の結果不明・停止2ケース。詳細は初回の R02–R05、R10–R11 を参照する。追加の8ケースを以下に示す。

| ID | 対象と行 | 問題 | 修正後に検出する不具合 |
| --- | --- | --- | --- |
| R12 | [codexCollaboration.test.ts](../../tests/unit/codexCollaboration.test.ts) 299行 | 否定した `arrayContaining(["plan", "goal"])` は両方の同時出現しか拒否しない | Codex 以外へ片方だけ補完が漏れる |
| R13 | [codexFeatures.test.ts](../../tests/unit/codexFeatures.test.ts) 76行 | 計画・差分を絞った後の `.every()` は空配列でも成功する | 計画・ターン差分の通知が丸ごと消える |
| R14 | [sandboxSetup.test.ts](../../tests/unit/sandboxSetup.test.ts) 139行 | モックが開始要求中に完了通知も同期送信する | 完了通知前に成功表示や接続の破棄が行われる |
| R15 | [piHistory.test.ts](../../tests/unit/piHistory.test.ts) 102行 | 「一覧と復元」とあるが、遅延させるのは一覧だけ | 切断後に解決した復元が新しい画面へ適用される |
| R16 | [codexHistory.test.ts](../../tests/unit/codexHistory.test.ts) 159行 | ページのカーソルと件数だけを観測する | 件数が同じまま履歴の内容・順序が変わる |
| R17 | [piSubagentAdapter.test.ts](../../tests/unit/piSubagentAdapter.test.ts) 86行、`context: "fork"` | 対応済みの値を未対応入力へ分類し、引継ぐ文脈を準備しない | 正常な分岐も拒否する実装、または文脈不足を無視する実装 |
| R18 | [piWorkflowDefinition.test.ts](../../tests/unit/piWorkflowDefinition.test.ts) 67行、`resume: "other"` | `agent` との併用違反で先に拒否され、参照先の確認に到達しない | 未解決の継続先を受理する |
| R19 | [sandboxSetup.test.ts](../../tests/unit/sandboxSetup.test.ts) 75行 | マニフェストの条件式を文字列の完全一致で固定する | 同じ意味の条件式への変更で試験が壊れる |

R12 は `plan` と `goal` をそれぞれ不在と検査する。R13 は対象 ID の存在・内容・完了状態を明示する。R14 は開始後も完了通知を保留し、その間は処理が完了しないことを確認する。通知後の成功と、遅れて届く失敗も区別する。

R15 は遅い復元を実際に開始してから接続を失効させる。古い復元結果の適用がなく、不要な接続も回収されることを確認する。R16 はページごとに異なる内容を置き、復元後の本文・ツール・順序を期待値と比較する。

R17 の [入力スキーマ](../../apps/vscode-nerita/src/extension/backends/pi/PiSubagentInput.ts) は `fork` を許可する。現状は [PiSubagentTool.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiSubagentTool.ts) で文脈の供給元がなく拒否される。供給元ありの正常例と、供給元なしの拒否理由を同じ担当で区別する。

R18 は [definition.ts](../../packages/shared/src/workflows/definition.ts) がモード検証を参照検証より先に行う。併用違反を確認するケースはその目的を明記する。未解決の継続先を試す場合は `agent` を外し、先行する違反を除く。単なる「何か例外が出た」で複数の安全境界を保護したことにしない。

R19 はコマンド ID の一致を残し、表示と有効化の条件は Windows と Pi の組合せで評価する。空白や論理積の順序を固定する必要はない。

## 実装を壊したときの実行結果

| 検証 | 結果 |
| --- | --- |
| 通常の Host スイート | 102ファイル、721ケース成功 |
| R12 の変異 | `collaborationModes=false` でも `plan` を追加する |
| R13 の変異 | `turn/plan/updated` と `turn/diff/updated` を認識対象から外す |
| R14 の変異 | `await finished;` を `void finished;` に置き換える |
| 上記3変異を同時に適用した関連3ファイル | 28ケース成功 |
| 同じ3変異を適用した Host スイート全体 | 102ファイル、721ケース成功、失敗0 |

各変異の適用ログを確認した。変異は Vitest の読込み時だけ適用し、元ファイルは変更していない。3か所を同時に変えた実行なので、独立した3回の全件実行とは数えない。実装とアサーションの照合でも、それぞれの見逃しを確認した。

再現用の診断ファイルと結果は `dist/testing-policy-audit-2026-10-01/` にある。主なファイルは `necessity-mutation.config.mts`、`host-results.json`、`necessity-mutated-results.json`。これらは一時的な監査資料であり、継続運用する回帰テストに数えない。

## 残す判断を過大にしない

以前「追加指摘なし」とした685ケースから、M05 の1ケースを統合へ変更した。残る684ケースは維持判定保留とする。静的な照合で入力境界や状態遷移を確認しても、各ケースを独立して残す費用対効果までは確定していなかった。残す根拠の監査は未完了であり、この数を必要なテスト数として扱わない。

「壊せば失敗する」だけでも維持理由としては足りない。標準 API の仕様を繰り返しているだけか、製品で重要な失敗を担当しているか、既存の担当へ統合できるかを判断する。固定入力かどうかや、テスト対象の関数が存在することだけで維持を決めない。

一方、似た名前だけで削除してはいけない箇所も確認した。

- `piRuntime` の旧プロバイダーと消失したプロバイダーは、別のフォールバック分岐を通る。
- `openResource` と `pastedPath` は、リンクを開く処理と貼付け解析という別の入口を持つ。
- `piApprovedTools` の Host・SDK・Host のみの取消しは、異なる信号の接続を確認する。
- `piTools` のシェル名3種は、名前の一覧に基づく表示分類を確認する。D03 の汎用ラッパーとは役割が違う。
- 承認前の実行0回、送信後の再送なし、破損時の書込み0回は、安全性やデータ保持の契約を守る。

反復実行の入口は `package.json` の `test:host` と `test:local` にある。ただし、入口があるだけでは実際の利用頻度は証明できない。実行履歴を確認せず、「作成時に1回だけ実行された」とは断定しない。

整理の優先順位は、検出漏れの修正、担当の統合、重複の削除とする。統合先の検査が、対象の不具合で失敗することを先に確認する。削除数や成功数を完了の基準にはしない。

## ファイルごとの集計

以下は実行時の721ケースと対応マークを照合した内訳。維持判定保留は、残すと決めた件数ではない。

| ファイル | ケース数 | 削除 | 統合 | 修正 | 維持判定保留 |
| --- | ---: | ---: | ---: | ---: | ---: |
| [contract/communicationSchemas.test.ts](../../tests/contract/communicationSchemas.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [contract/piStorage.test.ts](../../tests/contract/piStorage.test.ts) | 3 | 0 | 1 | 0 | 2 |
| [integration/piHttpMcp.test.ts](../../tests/integration/piHttpMcp.test.ts) | 8 | 0 | 1 | 2 | 5 |
| [integration/piReasoning.test.ts](../../tests/integration/piReasoning.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [integration/piResourceSettings.test.ts](../../tests/integration/piResourceSettings.test.ts) | 1 | 0 | 0 | 0 | 1 |
| [integration/piToolFeatures.test.ts](../../tests/integration/piToolFeatures.test.ts) | 16 | 0 | 0 | 0 | 16 |
| [integration/piToolFeatureSession.test.ts](../../tests/integration/piToolFeatureSession.test.ts) | 1 | 0 | 0 | 1 | 0 |
| [unit/agentEffort.test.ts](../../tests/unit/agentEffort.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/agentManager.test.ts](../../tests/unit/agentManager.test.ts) | 15 | 0 | 0 | 0 | 15 |
| [unit/agentManagerPanel.test.ts](../../tests/unit/agentManagerPanel.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/attachmentDrop.test.ts](../../tests/unit/attachmentDrop.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/backendRuntime.test.ts](../../tests/unit/backendRuntime.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/changeContext.test.ts](../../tests/unit/changeContext.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/changeSubmission.test.ts](../../tests/unit/changeSubmission.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/chatItems.test.ts](../../tests/unit/chatItems.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/chatSearch.test.ts](../../tests/unit/chatSearch.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/chatViewProvider.test.ts](../../tests/unit/chatViewProvider.test.ts) | 21 | 0 | 0 | 0 | 21 |
| [unit/codeReferenceSubmission.test.ts](../../tests/unit/codeReferenceSubmission.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/codexApprovals.test.ts](../../tests/unit/codexApprovals.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/codexCollaboration.test.ts](../../tests/unit/codexCollaboration.test.ts) | 10 | 0 | 0 | 1 | 9 |
| [unit/codexFeatures.test.ts](../../tests/unit/codexFeatures.test.ts) | 11 | 0 | 0 | 1 | 10 |
| [unit/codexHistory.test.ts](../../tests/unit/codexHistory.test.ts) | 14 | 0 | 0 | 1 | 13 |
| [unit/codexInputs.test.ts](../../tests/unit/codexInputs.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/codexSelection.test.ts](../../tests/unit/codexSelection.test.ts) | 8 | 0 | 2 | 0 | 6 |
| [unit/codexSession.test.ts](../../tests/unit/codexSession.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/codexSubmission.test.ts](../../tests/unit/codexSubmission.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/codexTransport.test.ts](../../tests/unit/codexTransport.test.ts) | 9 | 0 | 0 | 0 | 9 |
| [unit/composerContent.test.ts](../../tests/unit/composerContent.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/copiedCode.test.ts](../../tests/unit/copiedCode.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [unit/guardrails.test.ts](../../tests/unit/guardrails.test.ts) | 22 | 0 | 0 | 0 | 22 |
| [unit/guardrailsSettings.test.ts](../../tests/unit/guardrailsSettings.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/handoffContext.test.ts](../../tests/unit/handoffContext.test.ts) | 16 | 1 | 0 | 0 | 15 |
| [unit/handoffGeneration.test.ts](../../tests/unit/handoffGeneration.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/handoffSubmission.test.ts](../../tests/unit/handoffSubmission.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/jevGuard.test.ts](../../tests/unit/jevGuard.test.ts) | 21 | 0 | 0 | 1 | 20 |
| [unit/lexicalComposer.test.ts](../../tests/unit/lexicalComposer.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/logout.test.ts](../../tests/unit/logout.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/mcpStatus.test.ts](../../tests/unit/mcpStatus.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/messageReferences.test.ts](../../tests/unit/messageReferences.test.ts) | 9 | 0 | 0 | 0 | 9 |
| [unit/messages.test.ts](../../tests/unit/messages.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/modelConfig.test.ts](../../tests/unit/modelConfig.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/modelEffort.test.ts](../../tests/unit/modelEffort.test.ts) | 2 | 0 | 2 | 0 | 0 |
| [unit/openAIModelCatalog.test.ts](../../tests/unit/openAIModelCatalog.test.ts) | 9 | 0 | 0 | 1 | 8 |
| [unit/openResource.test.ts](../../tests/unit/openResource.test.ts) | 15 | 0 | 0 | 0 | 15 |
| [unit/pastedPath.test.ts](../../tests/unit/pastedPath.test.ts) | 14 | 0 | 0 | 0 | 14 |
| [unit/permissionPresentation.test.ts](../../tests/unit/permissionPresentation.test.ts) | 10 | 0 | 0 | 0 | 10 |
| [unit/personality.test.ts](../../tests/unit/personality.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/personalityClient.test.ts](../../tests/unit/personalityClient.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/piAccount.test.ts](../../tests/unit/piAccount.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/piAccountRecovery.test.ts](../../tests/unit/piAccountRecovery.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/piAgentHistory.test.ts](../../tests/unit/piAgentHistory.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/piAgentModels.test.ts](../../tests/unit/piAgentModels.test.ts) | 1 | 0 | 0 | 0 | 1 |
| [unit/piAgentViews.test.ts](../../tests/unit/piAgentViews.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/piApprovals.test.ts](../../tests/unit/piApprovals.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/piApprovedTools.test.ts](../../tests/unit/piApprovedTools.test.ts) | 9 | 4 | 0 | 0 | 5 |
| [unit/piAuthPanel.test.ts](../../tests/unit/piAuthPanel.test.ts) | 1 | 0 | 0 | 0 | 1 |
| [unit/piChildRuntimes.test.ts](../../tests/unit/piChildRuntimes.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/piContextUsage.test.ts](../../tests/unit/piContextUsage.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [unit/piDeviceId.test.ts](../../tests/unit/piDeviceId.test.ts) | 1 | 0 | 0 | 0 | 1 |
| [unit/piForkContext.test.ts](../../tests/unit/piForkContext.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/piHistory.test.ts](../../tests/unit/piHistory.test.ts) | 7 | 0 | 0 | 1 | 6 |
| [unit/piHistoryMapper.test.ts](../../tests/unit/piHistoryMapper.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/piJobs.test.ts](../../tests/unit/piJobs.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/piMcpConfig.test.ts](../../tests/unit/piMcpConfig.test.ts) | 4 | 0 | 0 | 1 | 3 |
| [unit/piModelCatalog.test.ts](../../tests/unit/piModelCatalog.test.ts) | 22 | 0 | 0 | 0 | 22 |
| [unit/piPlatformTools.test.ts](../../tests/unit/piPlatformTools.test.ts) | 5 | 1 | 0 | 0 | 4 |
| [unit/piProviderControls.test.ts](../../tests/unit/piProviderControls.test.ts) | 12 | 0 | 0 | 0 | 12 |
| [unit/piProviders.test.ts](../../tests/unit/piProviders.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/piQuota.test.ts](../../tests/unit/piQuota.test.ts) | 26 | 3 | 0 | 0 | 23 |
| [unit/piResultDisplay.test.ts](../../tests/unit/piResultDisplay.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/piRuntime.test.ts](../../tests/unit/piRuntime.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [unit/piSandboxTools.test.ts](../../tests/unit/piSandboxTools.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/piSelectionRestore.test.ts](../../tests/unit/piSelectionRestore.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/piSession.test.ts](../../tests/unit/piSession.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/piShellTools.test.ts](../../tests/unit/piShellTools.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [unit/piSteer.test.ts](../../tests/unit/piSteer.test.ts) | 14 | 0 | 0 | 0 | 14 |
| [unit/piSubagentAdapter.test.ts](../../tests/unit/piSubagentAdapter.test.ts) | 17 | 0 | 3 | 1 | 13 |
| [unit/piSubagentDefinitions.test.ts](../../tests/unit/piSubagentDefinitions.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/piTools.test.ts](../../tests/unit/piTools.test.ts) | 9 | 0 | 1 | 0 | 8 |
| [unit/piWorkflowChildren.test.ts](../../tests/unit/piWorkflowChildren.test.ts) | 1 | 0 | 0 | 0 | 1 |
| [unit/piWorkflowDefinition.test.ts](../../tests/unit/piWorkflowDefinition.test.ts) | 10 | 0 | 0 | 1 | 9 |
| [unit/piWorkflowEditorRun.test.ts](../../tests/unit/piWorkflowEditorRun.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/powerShellExecutable.test.ts](../../tests/unit/powerShellExecutable.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/referenceClipboard.test.ts](../../tests/unit/referenceClipboard.test.ts) | 1 | 0 | 0 | 1 | 0 |
| [unit/resolvePath.test.ts](../../tests/unit/resolvePath.test.ts) | 6 | 0 | 0 | 0 | 6 |
| [unit/sandboxExecutor.test.ts](../../tests/unit/sandboxExecutor.test.ts) | 9 | 1 | 0 | 0 | 8 |
| [unit/sandboxPolicyApproval.test.ts](../../tests/unit/sandboxPolicyApproval.test.ts) | 7 | 0 | 0 | 0 | 7 |
| [unit/sandboxSetup.test.ts](../../tests/unit/sandboxSetup.test.ts) | 7 | 2 | 0 | 2 | 3 |
| [unit/sessionReferences.test.ts](../../tests/unit/sessionReferences.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/sessionTitle.test.ts](../../tests/unit/sessionTitle.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/skills.test.ts](../../tests/unit/skills.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/statePublisher.test.ts](../../tests/unit/statePublisher.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/subAgents.test.ts](../../tests/unit/subAgents.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/timeline.test.ts](../../tests/unit/timeline.test.ts) | 2 | 0 | 0 | 0 | 2 |
| [unit/trustPanel.test.ts](../../tests/unit/trustPanel.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/uiContributions.test.ts](../../tests/unit/uiContributions.test.ts) | 8 | 0 | 0 | 0 | 8 |
| [unit/workflowEditor.test.ts](../../tests/unit/workflowEditor.test.ts) | 3 | 0 | 0 | 0 | 3 |
| [unit/workflowPanel.test.ts](../../tests/unit/workflowPanel.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/workspace.test.ts](../../tests/unit/workspace.test.ts) | 5 | 0 | 0 | 0 | 5 |
| [unit/workspacePaths.test.ts](../../tests/unit/workspacePaths.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/workspaceSymbols.test.ts](../../tests/unit/workspaceSymbols.test.ts) | 4 | 0 | 0 | 0 | 4 |
| [unit/workspaceTrust.test.ts](../../tests/unit/workspaceTrust.test.ts) | 27 | 0 | 0 | 0 | 27 |


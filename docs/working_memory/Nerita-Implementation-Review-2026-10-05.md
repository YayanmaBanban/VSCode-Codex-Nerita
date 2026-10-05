# Nerita 実装レビュー報告書

## 修正後の継続事項（2026-10-05）

以下の第1〜9節は修正前のレビュー根拠であり、現在の未対応一覧ではない。001〜008・010〜014の不具合、Storybook の責務、検出判定、文書矛盾は修正した。009のうち、承認待ちの本文変更・ハードリンク・祖先ディレクトリの置換・ジャンクションの差し替えは正式な製品テストで保護する。Pi Steer の完了・Stop・連打・次回への持ち越し・保存復元、スキーマの拒否条件と参照保持、失敗後の続行も同様である。Codex handoff の成功・失敗・生成中 Stop も正式な製品テストで保護する。

この記録は、全フェーズの再認定に必要な条件と、修正前の根拠を追跡するために残す。Notion の Phase 10・16・17・18には現行契約、満たした完了条件、継続事項を反映した。今回追加したテストの成功を、全条件の確認済みという意味に広げない。

| 継続事項 | 次の対応条件 |
| --- | --- |
| 009の残る個別経路：Pi compaction の設定保持・ログアウト、Codex 承認・新規会話 | 各バックエンドの既存担当を拡張し、本番の状態遷移・次の要求・保存結果で確認する。今回の代表経路の追加だけで全移管完了とはしない |
| 実際の認証・外部サービス・外部 Pi 拡張 | 対象アカウントとサービスで OAuth のログイン・更新、利用枠、priority、認証付き MCP、Web 拡張を確認する |
| 長い履歴の要約品質、遅い画面ストリーミング、長時間・低速ディスクの負荷 | ローカルの短い応答・範囲取得の成功とは別に測定する |
| 全画面の VS Code 変数未定義時の明暗表示、画像ワーカー・すべてのアイコン/F5 | 今回の Webview 本体と、結果不明・性格設定・認証画面の明暗・狭幅の画像だけで、全画面を確認済みとしない |
| 外側の `ToolCard` の折りたたみと詳細範囲の解放 | 詳細ビュー自身を閉じる現在の契約に、外側の折りたたみも含めるか決める |
| バックエンド設定値・実接続・再読み込み待ちの表示語 | 設定ファイル変更時の表示と実接続の意味を統一する。保存待ちの送信拒否とは別の論点として扱う |
| Phase 19・21の既知の継続課題 | 本文保存・履歴負荷、全文書の意味分類、差分自動選別などを各フェーズの条件に従って確認する |

修正後の UI 比較には次の画像を使う。第6節の画像は修正前の比較根拠として扱う。

- `dist/ui-review/nerita-distribution-RIugix/`
- `dist/ui-review/implementation-review-1791170897719/`

## 1. レビュー概要

レビュー日：2026-10-05。対象は Notion「実装フェーズ」で状態が「実装済み」の全21フェーズ。各フェーズに新規 `gpt-6.1-sol` / `high` サブエージェントを1名ずつ割り当て、ページ本文を全文取得してから現在の要求と実装を照合した。統括レビュアーが実行検証、後続仕様の確認、指摘の重複統合と最終判定を担当した。

Codex / Pi の共通セッション、Host / Webview の分離、宣言型 UI、承認前の Trust 判定、単回実行許可、出力の範囲取得という主要構成は現在も成立している。新規 VSIX の生成、同梱 SDK の製品検証、Extension Host 本体の起動に成功した。Webview 本体の承認・停止・切替・復元も確認した。準備済みの Windows Sandbox では、書き込み境界と子孫プロセスの停止を検証した。

一方、全フェーズを完了と再認定できない。**High 1件、Medium 10件、Low 3件の計14件の指摘**を確認した。最優先は FINDING-001 である。Pi の履歴切替に失敗すると、画面は元の会話を保持して接続済みへ戻る。しかし、元ランタイムは既に破棄されており、続行送信が失敗する。履歴切替の失敗時に元会話を保持する契約を満たさないため、リリース前の修正が必要と判断する。

承認迂回、未信頼コードの無断ロード、保存済み元履歴の破壊を今回新たに実証した指摘はない。Trust 保存失敗後の復旧不能、MCP の結果不明の誤分類、バックエンド切替中の受理済み送信の消失などは残る。Windows の完全な通信隔離、信頼済み拡張 JavaScript の直接 I/O の完全隔離は、Notion が明示する既知制約であり、新規の境界突破として数えていない。

判定は PASS 6、PARTIAL 9、FAIL 1、UNVERIFIED 3、SUPERSEDED 2。PASS は該当フェーズの現在の主要要求を、コード経路と今回の検証で支持できるという意味であり、外部サービス・全手動操作・長時間性能を網羅したという意味ではない。重要条件が未確認の Phase 4・11・12 は UNVERIFIED とした。

### 対象リビジョンと未コミット変更

ブランチは `main`、HEAD は `b3ebc519d566b8ff314d6a58f343c947691126e5`。開始時点で次の7ファイルにステージ済みの変更があり、保持した。

- `apps/nerita-ui/src/agentManager/AgentManager.tsx`
- `apps/nerita-ui/src/agentManager/AgentSettings.tsx`
- `apps/nerita-ui/src/chat/connection/ConnectionHeader.tsx`
- `apps/nerita-ui/src/ui/ActionNotice.tsx`
- `apps/nerita-ui/stories/agentManager/AgentManager.stories.tsx`
- `tests/scratch/agent-manager-controls-review.cjs`
- `tests/scratch/agent-manager-notice-review.cjs`

実行検証と VSIX はこの作業ツリーから生成した。従って、**未コミット変更のない HEAD をビルドした結果ではない**。`ConnectionHeader` の差分は通知のアニメーションと `key` に関する変更である。Agent Manager の差分は表示・操作に関する変更である。報告した Host / Shared の不具合箇所には開始時の変更がない。画像は変更込みの UI の証拠として扱う。製品コード・設定・Notion・README・CHANGELOG をレビューのために編集していない。

## 2. 対象範囲

データソース ID は `f00fbd56-682d-4a78-be15-5fb7b568775b`。指定ビューの全行を取得し、`has_more=false` を確認してから状態で選別した。概要だけで判定せず、全対象ページの本文、実装記録、対象外、既知制約まで確認した。取得結果に切り詰め・未知ブロックの通知はなかった。

| フェーズ | 判定 | 確信度 | 指摘 | 補足 |
| --- | --- | --- | --- | --- |
| 1 最小疎通 | PASS | High | — | SDK 本体、共通コントローラー、本文配信、UI 本体の送信・停止。遅い多チャンクの実際の画面描画は留保 |
| 2 ツールカード | PASS | High | 005、006は後続との関連 | 正規化・タイムライン・失敗/停止・後続の出力方式を確認 |
| 3 Permission Gate | PASS | High | 009は継続保護の関連 | 承認前未実行、許可後1回、拒否/Stop/失効、UI 本体と OS 境界を確認 |
| 4 Steer | UNVERIFIED | High | 009 | 通常追加指示は成功。連打・遅い受付・完了/Stop 競合の現行実証が不足 |
| 5 セッション / 履歴 | FAIL | High | 001 | 切替失敗後に元ランタイムが破棄済みのまま `ready` へ戻る |
| 6 バックエンド選択 | PARTIAL | High | 002 | 通常切替は成功。設定保存待ちの新規送信を旧ランタイムが受理する |
| 7 ランタイム / UI Contribution | PASS | High | — | 選択 bundle、プロバイダー 登録、汎用 UI、すべてのスロット・条件判定 |
| 8 Provider Controls / カタログ | PARTIAL | High | 004、014 | 内部タイムアウトで成功カタログを表示側から失う |
| 9 Zod 通信 Schema | PASS | High | 009 | 現ガードの35 アサーション成功。継続して検証するテストの欠落は Phase 18 と統合 |
| 10 `ModelRuntime` / 能力情報の補完 | SUPERSEDED | High | 004、014は現在設計への関連 | 候補の採用基準契約の一部を Phase 17 の実サービスの確認後に定めた仕様が明示的に置き換えた |
| 10-1 推論上書き | SUPERSEDED | High | — | 基準状態/`configuration_update`/固定指定は Phase 17 で撤去。通常推論は SDK へ |
| 11 Sandbox / Approval | UNVERIFIED | High | 009 | 現 VSIX の OS 書き込み境界・子孫停止は成功 |
| 11-2 ワークスペース / External Trust | PARTIAL | High | 003、013は関連 | 保存失敗後にすべてのルートの実効 Trust が復旧しない |
| 12 セッション参照 / Handoff | UNVERIFIED | Medium | 009は関連 | 共通契約・Pi 生成失敗・期限は確認。Codex 生成・生成中 Stop 等の受入が不足 |
| 16 Storybook モック整理 | PARTIAL | High | 007、009 | 主要ブリッジ整理済み。性格設定・認証エディター に状態の再実装が残る |
| 16-1 UI / Shared 分離 | PASS | High | — | 境界・exports・配布一致・UI 本体を確認。watch/変数が未定義の場合の全画面は未実行 |
| 16-2 Extension App / media | PARTIAL | High | 012、013 | 配布成功。ブランドだけの変更は watch に乗らず、Manifest 重複あり |
| 17 Pi 新機能統合 | PARTIAL | High | 004、005、014 | 安全境界は接続。MCP 結果不明の Shared/UI 状態がない。実サービスでの OAuth 等は未実施 |
| 18 テスト再構築 | PARTIAL | High | 008、009 | 現スイート成功。ただし任意のアサーションを回帰検出と扱い、一部旧保護が未移管 |
| 19 出力軽量化 / 遅延取得 | PARTIAL | High | 006 | 保存・復元・Fork・範囲取得は成功。不正先頭 UTF-8 を検証せずに除外する |
| 21 日本語校正 / スロップ検出 | PARTIAL | High | 010、011 | 分類/保存は成立。長いコードフェンスと参照形式リンクの保護で誤検出 |

対象外の「計画」は Phase 11-1、12-1、13、14、15、20、22。既存実装や後続設計の解釈に必要な範囲で参照したが、これらを実装済みとして対象範囲に混ぜていない。Phase 21 は製品のチャット機能ではなく、リポジトリ内の校正スキルのレビューである。

## 3. 重大・高優先度の指摘

Critical は今回実証していない。

### FINDING-001：Pi の会話切替に失敗すると、元会話の表示は残るがランタイムは破棄済みになる

- 重要度： High
- 確信度： High
- 分類： Bug
- 対象フェーズ： 5
- 関連フェーズ： 11、18、19
- 期待する動作： load / Fork / 初回送信前の保存先更新が失敗しても、元の会話と稼働可能な接続を保持して続行できる。Phase 5 本文の失敗時の保持契約、および現在の `connect` の保持方針に対応する。
- 実際の動作： 切替開始で元接続の `signal` を中止状態にし、元 SDK を終了する。失敗処理は元の `sessionId` とメッセージを残して `ready` に戻すため、表示と稼働状態が食い違う。
- 根拠：接続切替は `apps/vscode-nerita/src/extension/backends/pi/PiLifecycle.ts:168` の `prepareConnection` を通る。`:175` で `opening.abort()` を実行する。`:183` の `reportConnectionFailure` は `:190` で `ready` へ戻す。`PiRuntimeLifetime.ts:6` の `bindPiRuntimeLifetime` は、`:39` で親の中止を終了処理へ接続する。`:31` で寿命管理用の `signal` を中止し、`:26` で SDK を破棄する。`PiFileTools.ts:86` も中止済みの `signal` を参照する。
- 再現方法：本番の `PiSessionController` と `bindPiRuntimeLifetime` をメモリー上で実行した。ビルドには `esbuild write:false` を使い、復元先のファクトリーだけを失敗させた。失敗後は `{connection:"ready",sessionId:"original",disposed:true}` となった。元会話の続行は `{run:"failed",error:"old runtime disposed"}` となった。外部通信・実ファイルの生成はしていない。
- 影響： 破損・削除された履歴等への切替に失敗した後、元会話が利用可能に見えるのに送信できない。保存先変更の失敗も同じ経路を通る。保存済み元履歴の削除・破壊は実証していない。
- 推定原因： 切替試行の取り消しと、保持する元ランタイムの寿命を同じ `AbortController` へ結び付けている。`:148` のランタイム交換も追加カタログ準備より先に行われる。
- 修正方針： 新接続の履歴・必要な準備が成功するまで元接続を維持し、成功後に交換・終了する。失敗後の続行送信を現在の履歴対象のテストで検証する。

`tests/product/pi-storage.test.ts:112` と `:148` は衝突・破損後の表示、ID、元ファイルの保持を検証するが、失敗後の続行送信を確認しない。このため今回の79件成功と本指摘は両立する。`git blame` では、切替前の中止・`ready` 復帰が `8700c807` に由来することを確認した。未コミット UI 変更による不具合ではない。導入コミットの特定が十分でないため、分類は Bug とし、Regression かどうかは断定していない。

## 4. フェーズをまたぐ指摘

### FINDING-002：バックエンド設定の保存待ちに受理した送信を、その後の切替で停止・消去する

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 6
- 関連フェーズ： 1、4、5、16
- 期待する動作： 切替受付後の会話操作も切替状態で制御し、受理済みの入力を旧バックエンドの終了で失わせない。実行中の切替を拒否する現在の規則を保存待ちにも維持する。
- 実際の動作： `backendPending` は別の `ui/setBackend` だけを抑制する。保存待ちに旧 Pi が `prompt/send` を受理し、その後保存が完了すると旧 SDK が終了して新会話へ交換される。
- 根拠：`apps/vscode-nerita/src/extension/webview/chatViewProvider.ts:227` に `changeBackend` がある。`:242` で `saveBackend` を呼ぶ。`:255` に `runtimeBusy`、`:296` に `session.receive` がある。交換処理は `session/BackendRuntime.ts:122` の `replace` にある。受付通知は `backends/pi/PiRun.ts:436` にある。
- 再現方法：本番の Provider / `BackendRuntime` / Pi コントローラーをメモリー上で実行した。VS Code 設定保存の Promise を保留し、切替要求、旧 Pi への送信、保存完了の順に進めた。結果は `oldRun=running, accepted=true, sdkPromptCalls=1` だった。さらに `sdkClosed=true, afterSession=codex-new, afterMessages=0` となった。設定保存と SDK 境界だけを代替した。
- 影響： 下書きの受付後に旧実行が停止し、表示中会話から入力が消える。未承認副作用や永続履歴全体の消失は実証していない。
- 推定原因： 保存開始からランタイム交換開始までの切替状態を、会話操作と UI へ公開していない。
- 修正方針： 保存開始前から新規送信・会話変更を拒否または保留し、拒否時は下書きを保持する。必要な Stop は旧実行へ届くようにする。

### FINDING-003：Trust の保存失敗後、明示的な信頼の再設定に成功してもすべてのルートが実行不可のままになる

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 11-2
- 関連フェーズ： 3、11、17
- 期待する動作： 保存失敗中は拒否し、復旧後の明示的な信頼の再設定の保存成功で記録・画面・実効 Trust が一致する。
- 実際の動作： 未信頼へ変更する際に増やす `pendingRestrictions` を失敗時に減らさない。再保存が成功して記録は `trusted` へ戻ってもすべてのルートの `trusted()` が `false` になる。
- 根拠：`apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore.ts:106` に `trusted` がある。`:204` の `change` は、`:229` で保存例外を処理する。`:236` では成功時だけカウンターを減らす。`TrustPanel.ts:42` は `store.list()` を表示する。
- 再現方法：Store 本体をメモリー上で実行し、ルートを信頼済みに設定した。信頼取り消し時の `storage.write` を1回失敗させ、保存機能を復旧後に `setUserTrust(true)` を成功させた。結果は `initial true / revoke failed simulated storage failure / record trusted effective false` だった。
- 影響： 保存障害後に Extension Host を再起動するまで全体の実行が拒否され、管理画面の `trusted` 表示と食い違う。安全境界の突破ではない。
- 推定原因： 制限中カウンターの増減が成功経路だけで対になっている。
- 修正方針： 失敗経路も含めてカウンターを解放し、失敗後の拒否は既存の `failed` 状態で維持する。保存成功後の実効状態の復旧を検証する。

### FINDING-004：カタログの内部タイムアウトが成功キャッシュを表示側から消す

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 8、17
- 関連フェーズ： 10、Provider / Model / Ultra / Fast
- 期待する動作：同一認証の成功カタログがあり、呼び出し元が取り消されていなければ、内部タイムアウト時も成功結果へ戻す。認証変更と呼び出し元の取り消しは分けて扱う。Phase 8-1 の成功キャッシュ方針は撤去されていない。
- 実際の動作： 内部の5秒タイムアウトを含む合成 `signal.aborted` が `true` なら `null` を返す。上位の呼び出し元は取り消されていないため、`null` が現在のスナップショットを上書きする。
- 根拠：`apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalogService.ts:20` に `read` がある。`:49` で例外を処理する。`PiModelCatalogService.ts:58` でスナップショットを更新する。`:68` の `available` は `null` のとき SDK 候補を全件通す。
- 再現方法： 本番 reader / service、同一モック OAuth、同一モデルで1回目は `public` だけを含む成功応答、2回目は実際の5秒タイムアウトまで待機。結果は `before=[public] / after=[public,not-in-live] / snapshotAfterTimeout=null`。メモリー実行で外部通信・認証利用なし。
- 影響： 既に除外したモデルが再表示され、同じメタデータに依存する Ultra / Fast の能力・有効状態も失われる。通常の SDK 推論値は維持される。
- 推定原因： 呼び出し元の取り消しと内部取得期限を `signal.aborted` で同じものとして扱う。
- 修正方針： 認証確認済みで呼び出し元が取り消されていなければ、内部の取得期限を過ぎた場合も同一の認証情報の成功キャッシュへ戻す。認証変更時はキャッシュを破棄する。

### FINDING-005：受理後に通信断した MCP 操作を、確定した失敗と同じ状態で表示する

- 重要度： Medium
- 確信度： High
- 分類： Spec gap
- 対象フェーズ： 17
- 関連フェーズ： 2、9、18、19
- 期待する動作： 送信済み遠隔操作の結果が不明なら、成功・失敗と区別した状態を Shared / UI に渡し、自動再試行しない。Phase 17 の明示要件。
- 実際の動作： 送信後切断を汎用 Error に変換し、`isError` から `failed` カードへ統合する。結果不明の Shared 状態がない。
- 根拠：`apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpServer.ts:292` で例外を処理する。`PiToolMapper.ts:245` の `toolStatus` で状態を変換する。共通の状態定義は `packages/shared/src/chatState.ts:62` にある。`tests/support/mcpServer.ts:73` は操作を記録後に応答を切断する。`tests/product/pi-mcp.test.ts:117` は `lost` でも `failed` と要求1回を期待する。
- 再現方法： 既存製品テストの lost ケース。今回の product と展開 VSIX の両方で成功したことは「操作1回、再送なし、`failed` に分類」の実行証拠であり、結果不明契約の充足を示さない。
- 影響： 遠隔処理が成立した可能性と確定失敗を利用者・モデルが区別できず、手動再実行で副作用を重複させる判断につながる。Host の自動再送は禁止されたまま。
- 推定原因： 送信前拒否、確定した遠隔エラー、送信後の結果不明を MCP 境界で共通の Error にする。
- 修正方針： 秘密を含まない結果不明のメタデータ・状態を、Shared、保存復元、子要約、UI に通す。deny / error / lost の期待を分ける。

### FINDING-006：不正な先頭 UTF-8 継続バイトを取得成功として検証せずに除外する

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 19
- 関連フェーズ： 2、5、17
- 期待する動作： Phase 19 の実装契約どおり、不正 UTF-8 は取得エラー。有効な文字の途中を指定した場合だけ次の境界へ進める。
- 実際の動作： offset=0 でも先頭の継続バイトを飛ばし、その後だけ fatal decoder に渡す。
- 根拠： `apps/vscode-nerita/src/extension/session/ToolOutputStore.ts:248` `readRange`、`:259` 先頭スキップ。
- 再現方法： 製品関数をそのまま抽出・変換して `readSync` だけをメモリー入力へ置換。bytes `[0x80,0x61]`、size=2、offset=0、limit=65536 に対して `{text:"a",offset:1,nextOffset:2,eof:true}` を返した。実際のファイル生成なし。
- 影響： 破損した外部/保存本文を成功として返し、内容のバイトを欠落させる。正常 UTF-8 には影響しない。
- 推定原因： 有効な多バイト文字の途中と、孤立した不正継続バイトを区別しない。
- 修正方針： offset=0 はスキップせず検証する。任意 offset は直前の少量のバイトも確認して有効な文字の境界として調整する。

### FINDING-007：一部 Storybook が設定・認証操作から独自の成功状態を導出する

- 重要度： Medium
- 確信度： High
- 分類： Spec gap
- 対象フェーズ： 16
- 関連フェーズ： 8、17、18
- 期待する動作： Storybook は表示状態・外部境界・送信メッセージの検証に限定し、Host の状態機械を複製しない。独立画面の編集バッファと固定応答は許容する。
- 実際の動作：性格設定のストーリーは保存・選択操作からプリセットを追加・更新し、選択状態を計算する。Pi Auth Editor は開始・取り消し・回答操作から状態を更新し、回答だけで `configured` を導出する。
- 根拠：性格設定の送信処理は `apps/nerita-ui/stories/chat/Personality.stories.tsx:39` の `postMessage` にある。認証は `PiAuthEditor.stories.tsx:31` の `send` と `:137` の `configuredAuthItems` にある。本番の性格設定は `apps/vscode-nerita/src/extension/backends/codex/settings/PersonalityStore.ts:99` にある。`change` の処理と比較した。本番認証は `backends/pi/PiAuthService.ts:111` の `handleRequest` と比較した。
- 再現方法：インラインハンドラーのコード経路を追跡した。本番の性格設定は固定設定・名前衝突・存在確認を、本番認証は SDK 完了後の再取得を伴う。ストーリーの成功状態は、その結果から生成していない。今回の108件のストーリーテスト成功は、この設計差を否定しない。
- 影響： 本番変更後の表示確認が独自成功状態に依存し、整理したはずの二重実装が残る。製品ランタイムの認証不具合ではない。
- 推定原因：主要ブリッジの整理が、すべてのインラインハンドラーに適用されていない。
- 修正方針： 送信メッセージを記録・検証し、入力待ち・成功・失敗の固定 DTO を明示的に注入する。

### FINDING-008：回帰注入で、目的と無関係なアサーション失敗も検出成功にできる

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 18
- 関連フェーズ： 全フェーズの検証結果
- 期待する動作： 狙った仕様のアサーション失敗を照合し、準備・接続・無関係な例外の失敗を検出能力の証拠にしない。
- 実際の動作： 非0終了と stdout の任意 `ERR_ASSERTION` を受理し、失敗したテスト・仕様を照合しない。stderr の別例外も検査しない。
- 根拠： `config/test-products.cjs:75` `verifyRegression`、`config/product-regressions.cjs` の変異テスト定義。`tests/support/pi.ts:19` `until` も待機失敗を `ERR_ASSERTION` にする。
- 再現方法：現在の関数を vm で読み取り、実行した。入力は `status:1` とし、stdout に `not ok 1 setup: connection readiness ERR_ASSERTION` を指定した。stderr には `SyntaxError: unrelated fixture failure` を指定した。これでも `broken-result` の回帰検出成功を出力した。ファイルは生成していない。
- 影響： 狙った保護が効かず別の待機条件だけが失敗しても、検出能力を証明したと表示できる。
- 推定原因： TAP の部分文字列の検索で成功を判定し、変異テストごとの期待失敗を持たない。
- 修正方針： 期待する対象のテスト・仕様失敗を変異テストごとに持ち、構造化した結果で照合する。想定外失敗と準備例外は別扱いにする。

今回10種類が失敗検出されたという実行結果は保持する。ただし、この判定器だけから「10種類すべてが目的のアサーションで失敗した」とは結論しない。

### FINDING-009：旧テストが守った重要条件の一部を、現在のテストでは継続して検証していない

- 重要度： Medium
- 確信度： High
- 分類： Verification gap
- 対象フェーズ： 18
- 関連フェーズ： 3、4、5、9、11、11-2、12、16
- 期待する動作： 旧体系の撤去前に、現行の重要な失敗経路を新しいテストへ移管し、保護しない条件の理由を記録する。Phase 18 の18-5/18-6 と安全性・データ保持の明示要件。
- 実際の動作： 通常の成功・拒否・取り消しの担当はあるが、下記の保護を現行の正式 product / VS Code / ストーリー群で確認できない。
- 根拠：`9286ba0^:tests/unit/piSandboxTools.test.ts` の U09 は承認待ちの内容変更を扱った。祖先のジャンクション差し替え・ハードリンク・Windows 特殊パスも検証していた。現在の `tests/product/pi-effects.test.ts:10` と `:65` は通常の書き込みと許可失効が中心である。製品の `security/FileSnapshot.ts:81` にある `verifyFileSnapshot` は残る。`PiFileTools.ts:104` と `:169` も残るが、現在のテストはこれらの競合を検証しない。
- 再現方法： 現テストの準備・操作・アサーションと削除前テストを比較した。内容変更やリンク差し替えを準備する操作がなく、OS 試験は実行許可の直接発行で Host ファイルツールを通らない。この保護の変異テスト実証は今回していない。
- 影響： 承認対象と異なるファイルの上書き・同時更新の消失などの回帰を、現スイートの成功だけでは検出できると保証できない。現在の製品に境界突破があるという指摘ではない。
- 推定原因： 通常実行・承認取り消しは移管した一方、対象同一性・特定競合・拒否条件の一部が担当から落ちている。
- 修正方針： 旧ケースを全件復元せず、現在の既存担当へ代表的な重要条件を加え、同じ失敗経路の変異テストを確認する。未対応機能の試験と区別する。

同じ継承不足として次も統合し、別指摘に重複登録しない。

- Steer：`tests/product/pi-conversation.test.ts:252` と `:294` は通常の追加指示が次の HTTP 要求に反映されることを確認する。連打、Stop 直後、遅い受付と完了の競合は直接検証しない。次回への持ち越し防止・保存復元も直接検証しない。対応実装は `PiRun.ts:197` / `:253` / `:370` / `:478` にある。
- Schema：Phase 9 の旧 `tests/fixtures/phase9/` は残っていない。ID 境界・候補重複・同値 toggle・when の拒否・未知キーと参照保持を継続して検証するテストは確認できない。`stories/chat/mocks/storyBridge.ts:18` はガードを通さず、Contributions のストーリーは正常描画が中心である。今回の35アサーションによるガードの検証と、継続的な回帰検証は分けて扱う。
- 失敗後継続：Pi storage の保持試験は元 messages/ID/file を確認するが、FINDING-001 の破棄済みランタイムでの続行を検出しない。
- Handoff / コントローラー：Codex handoff、生成中 Stop、Pi compaction 選択、ログアウト、Codex 承認・新規会話の個別担当を関連検索で確認できなかった。通信スタブや表示注入だけで本番結果を認定しない。

Jev の旧試験撤去はここへ含めない。現在 configure の本番接続がなく、既存 `docs/working_memory/Jev-Guard.md` が認証・有効化待ちを明記する。未対応機能の有効化は Phase 18 の対象外である。

### FINDING-010：長い Markdown コードフェンスを内側の短いコードフェンスで閉じ、コードを誤検出する

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 21
- 関連フェーズ： 日本語校正スキルの抽出・既存保護処理
- 期待する動作： バッククォート4個で開始したコード領域は内側の3個で閉じない。コード内は検査せず、正式に閉じた後の本文を検査する。
- 実際の動作：コード内の `正本` を `ai-slop-pattern` とし、その後の本文の `土台` が検査対象から落ちる。
- 根拠：`.agents/skills/japanese-proofreading/scripts/textlint-audit.mjs:94` に抽出処理がある。`extractDocumentAuditItems` はコードフェンスの文字を保持するが、長さを保持しない。
- 再現方法：OS の一時領域に sample.md を作成した。5行の内容は順に「バッククォート4個+text」「3個」「`設定の正本を更新する`」「4個」「`設計の土台にする。`」とした。`--review-all sample.md` はコード内の3行目をエラーとし、本文の5行目を見逃して終了コード1を返した。製品・リポジトリのキャッシュは変更していない。
- 影響： 正常なコード例で lint が失敗し、その後の本文もレビュー候補から欠落する。
- 推定原因： 開始と閉じの長さを検証せず、同じ文字で開閉を反転する既存抽出を利用した。
- 修正方針： 開始長と対応する閉じ条件を保持し、内側の短いコードフェンスと終了後の本文を同じ境界例で確認する。

### FINDING-011：参照形式リンクの非表示識別子を文章として検出する

- 重要度： Medium
- 確信度： High
- 分類： Bug
- 対象フェーズ： 21
- 関連フェーズ： 日本語校正スキルのリンク保護
- 期待する動作： `[リンク][正本]` の非表示参照ラベルと `[正本]: ./example.md` の定義を保護し、読者に表示する本文を検査する。
- 実際の動作： 両方の参照ラベルを2件の `ai-slop-pattern` として保存し、終了1になる。
- 根拠：保護処理は `.agents/skills/japanese-proofreading/scripts/textlint-protected.mjs:55` にある。`maskProtectedText` は URL とインラインリンクを保護するが、参照形式を扱わない。
- 再現方法：一時的な sample.md に `参照 [リンク][正本]`、空行、`[正本]: ./example.md` を置いた。`--review-all sample.md` で実行し、2件の診断を確認した。
- 影響： 読者に表示されないリンク識別子で通常 lint が失敗する。
- 推定原因： 保護処理がインライン形式のみを想定する。
- 修正方針： 参照ラベル・定義を保護し、表示ラベル内の検査は維持する境界例を追加する。

### FINDING-012：ブランド資産だけの変更が watch の配布先へ反映されない

- 重要度： Low
- 確信度： High
- 分類： Regression
- 対象フェーズ： 16-2
- 関連フェーズ： 16-1、Build / Distribution
- 期待する動作： media を UI の編集元から dist へコピーする開発経路でも、ブランド資産だけの変更を watch 中の表示確認へ反映する。
- 実際の動作： 3ブランド資産は import と Tailwind の監視対象に入らず、UI 再ビルドの `onEnd` が起きるまで再収集されない。
- 根拠：資産収集は `apps/vscode-nerita/build.cjs:14` の `collectUiArtifacts` にある。`:79` で `createUiBuild` と接続する。監視入力は `apps/nerita-ui/tailwind-esbuild.cjs:32` と `src/chat/tailwind.css:5` で確認した。`nerita.svg`、`nerita-24.svg`、`nerita_store_icon.png` はコピー専用である。
- 再現方法： 静的に監視入力と再収集経路を照合した。条件は `pnpm watch` 後にブランド3点のいずれかだけを更新すること。レビュー中の製品素材変更による動的再現はしていない。
- 影響： watch 中だけ古いブランド表示を見てしまう。通常 build / package のコピーと VSIX は成功している。
- 推定原因： 直接 media 参照から dist コピーへ移した際、コピー元を独立した監視入力にしなかった。
- 修正方針： 3点を明示的に監視し再収集する。修正後は1点だけの更新と出力一致を確認する。

### FINDING-013：Trust コマンドの Manifest 宣言が重複している

- 重要度： Low
- 確信度： High
- 分類： Bug
- 対象フェーズ： 16-2
- 関連フェーズ： 11-2
- 期待する動作： 同じコマンド ID の Manifest 宣言は1件。
- 実際の動作： `nerita.trust.manage` が異なる表示名で2件宣言され、新規 VSIX 起動時に `already registered` 警告が出る。
- 根拠： `apps/vscode-nerita/package.json:150` / `:158`。Host 登録は `security/trust/TrustCommands.ts:71` の1箇所。Extension Host 本体ログにも同じ警告を確認した。
- 再現方法： 今回の `pnpm test:distribution` の VS Code 本体起動。Trust コマンド自体と受入は成功した。
- 影響： 起動警告とコマンド表示名の重複。実行不能は確認していない。
- 推定原因： 同じ ID の宣言を整理しないまま引き継いだ。`git show 2291336c^:package.json` にも存在するので、モノレポ移動で導入した回帰ではない。
- 修正方針： Manifest を1件に統合し、警告の消失と Trust コマンドの正常操作を確認する。

### FINDING-014：モデル候補の現行契約が Phase 10 と Phase 17 内で一致しない

- 重要度： Low
- 確信度： High
- 分類： Documentation drift
- 対象フェーズ： 10、17
- 関連フェーズ： 8
- 期待する動作： Phase 17 の実測後に採用した公開モデルの SDK/live 共通部分を現行契約として揃える。
- 実際の動作： Phase 10 は SDK の候補だけを採用基準とし、ライブ一覧に未掲載または hide / none でも維持することを要求する。Phase 17 冒頭は双方にある公開モデルだけを表示と明記する一方、後半には引き続き Pi 基準・旧補助カタログを通常一覧の基準にしない説明が残る。
- 根拠：両ページの全文と製品コードを照合した。候補の絞り込みは `apps/vscode-nerita/src/extension/backends/pi/PiModelCatalogService.ts:68` の `available` にある。モデル調整は `PiAccount.ts:257` の `reconcileModel` にある。
- 再現方法：本番の service / account をメモリー上で確認した。SDK にある `new` / `hidden` / `none` はライブ一覧の公開候補になければ消える。現在モデルを `new` から `old` へ調整する。Phase 17 冒頭の期待とは一致し、旧 Phase 10 の期待とは一致しない。
- 影響： 受入・回帰テスト・レビューが違う期待値を持ち、現在の意図的なフィルターを不具合として撤去する判断につながる。
- 推定原因： 実際のサービス結果を追記した際に、旧受入条件と後半の説明を同期していない。
- 修正方針： Phase 10 の置換範囲を明記し、現候補基準、失敗時の代替処理、正常空一覧の扱いを Phase 17 内でも揃える。レビュー時点では Notion を変更していない。

### 横断確認で成立した境界

Trust → Guardrails → Jev の有効時判定 → Human Approval → 単回実行許可 → 実行直前の Trust / Abort 再検査という順序を確認した。未信頼の副作用は承認より前に拒否される。承認待ちの設定変更・Trust 取り消し・Stop 後には古い許可を使えない。Host の履歴保存やモデル通信と、要求されたツール本体の副作用は別責務として扱った。

子の起動と子のファイル変更には、それぞれ承認がある。権限は親と `role` が許可する範囲の共通部分に限定され、停止は起動中の子にも伝播する。MCP の初期・動的登録、`tool_search` からの利用、`codemode` の実引数による子の呼び出しにも共通経路がある。明示的に信頼された拡張の任意 JavaScript による直接 I/O には、ツール登録ラッパーと同じ隔離保証はない。

出力履歴は Codex の保存イベント、Pi SDK の保存結果と必要な追加本文を基準にする。内部構造を公開しない `outputRef` は現在の会話の一時キャッシュを参照し、切替時に失効する。Codex の出力ストアは復元成功後だけ交換される。Pi の FINDING-001 と同じ破棄症状を Codex では実証していない。

## 5. フェーズ別レビュー

以下の `EH/` は `apps/vscode-nerita/src/extension/`、`UI/` は `apps/nerita-ui/`、`SH/` は `packages/shared/src/`。省略する場合もリポジトリ相対の配置を示す。対象外・手動で確認する条件が原文にない初期ページでは、記載なしを明示し、推測で要求を増やしていない。

### Phase 1 最小疎通

一次資料ページ ID：`3e34b8edfa4e815b8ab5efb40ce01597`。

意図・契約：Pi SDK 依存、ランタイム、ワークスペース cwd、固定 coding tools の1ターン、`ChatSession` コントローラー、既存メッセージ表示、Stop の7項目。受入は入力欄から送信し、Pi 応答をストリーミング表示して中断できること。固有の対象外範囲・既知制約・手動手順は記載なし。後続の配置変更・ツール拡張・承認・SDK 変更を適用する。

**対応箇所**

- `EH/backends/pi/PiRuntime.ts:647` `loadPiSdk`
- `:821` `createConfiguredPiSession`
- `backends/createBackend.ts:76` cwd
- `PiRuntimeTools.ts:33` tools
- `PiSessionController.ts:9` 共通契約
- `PiRun.ts:445`→`PiEventMapper.ts:17`→`UI/src/chat/useChat.ts:18`→`messages/Messages.tsx:32` が本文配信
- `PiRun.ts:370` が取り消し。

検証・判定：PASS。SDK 本体の本文配信・ツール実行、UI 本体での送信・Stop、配布入口起動を確認。モデルの検証データは SSE の応答を一括で終了するため、長時間の遅い多チャンクを実際の画面で逐次描画する厳密な受入は未確認。独立指摘なし。

### Phase 2 ツールカード

一次資料ページ ID：`3e34b8edfa4e81de8d27ce59286da8c0`。

意図・契約：開始/更新/終了から `ToolSummary`、読み取り/書き込み/編集/シェルの表示名/パス/状態、Storybook、失敗表示を共通タイムラインへ接続する。対象外・固有制約・手動手順の独立記載なし。Phase 17 の構造化結果、19 のプレビュー/詳細取得は現在仕様。

**対応箇所**

- `EH/backends/pi/PiToolMapper.ts:15` / `:180` / `:219` / `:240`
- `PiEventMapper.ts:15`
- `session/sessionState.ts:88`
- `SH/toolUpdates.ts:27`
- `UI/src/chat/messages/Messages.tsx:120` が本文・ツール・子を整列する
- `tools/ToolCard.tsx:181` / `:417` が失敗・停止を表示する。

検証・判定：PASS。コマンド保持・書き込み完了・停止、カード本体のストーリー群、Webview 本体の書き込み/読み取り/出力/復元を確認。全ツール種の UI 本体での操作の網羅は未実施。005・006は後続の同じ原因の指摘とし重複登録しない。

### Phase 3 Permission Gate

一次資料ページ ID：`3e34b8edfa4e810ba2badeb8af1338cf`。

意図・契約：ツール呼出し前の承認要求、`permission/respond`、Allow once/Reject、Stop/disconnect の待機解除、安全な書き込み/編集/シェル既定方針。標準読み取り/ls は承認不要、副作用と拡張登録ツールは毎回承認。固有の対象外範囲は記載なし。後続11/11-2/17の Trust と固定実行許可を適用する。

**対応箇所**

- `EH/backends/pi/PiPermissions.ts:14`
- `session/Approvals.ts:20` / `:70`
- `PiSessionController.ts:208`
- `security/ApprovalGuard.ts:37`
- `ApprovedToolCall.ts:39`
- `PiFileTools.ts:89`
- `PiPowerShellTool.ts:58`
- 拡張動的登録は `PiExtensionTools.ts:52`、子は `PiChildRuntimes.ts:66`
- `codemode` は `PiToolFeatures.ts:187`、MCP は `mcp/PiMcpServer.ts:303`。

検証・判定：PASS。承認前無書き込み・許可後1回、拒否/Stop/revoke/settings 後の古い許可拒否、子の個別承認、`codemode` 書き込み、UI 本体の承認と停止、OS 境界を確認。実際の外部拡張・通信先のすべての取り消し競合は未実施。009の継続保護不足は残る。

### Phase 4 Steer

一次資料ページ ID：`3e34b8edfa4e81bcbd8ddcc018b0e737`。

意図・契約：実行中 Composer を同一ターンの SDK `steer` へ接続し、連打/Stop 直後/完了競合を検証する。開始受付前・追加受付中・停止中を拒否し、元 prompt 完了時にも追加受付終了を待ち、次回キューへ持ち越さない。対象外・固有手動手順の章はない。当時の Webview 本体は未検証。

**対応箇所**

- `UI/src/chat/composer/usePromptSubmission.ts:111` / `:144`
- `EH/backends/pi/PiRun.ts:197` / `:235` / `:253` / `:370` / `:478`
- `PiRuntime.ts:309` のファサードは SDK 本体 `steer` を維持する
- `BackendRuntime` と接続世代が切替後の通知を排除する。

検証・判定：UNVERIFIED。現在の通常 `steer` は次 HTTP 要求への反映に成功。必要な非同期競合の直接実証と `steer` 本文の独立復元を現在のテストで確認できない。製品が競合で壊れると断定していない。指摘 009。

### Phase 5 セッション / 履歴

一次資料ページ ID：`3e34b8edfa4e812eb038daeda0a7a260`。

意図・契約：一覧、load/switch、新規、Fork、再起動後の手動復元。ID 再照合・実行中/切替中拒否、成功後交換、失敗時に元会話を保持。Fork は別 ID/ファイルで元を変更しない。自動再開、rename/削除/archive は対象外。global/ワークスペース保存先と初回送信前の設定再評価を現在の契約へ含める。

**対応箇所**

- `EH/backends/pi/PiHistory.ts:9` / `:47`
- `PiSessionStore.ts:46` / `:102` / `:193` / `:236`
- `PiHistoryMapper.ts:12`
- `PiLifecycle.ts:102`
- `results/PiOutputArchive.ts:99`
- UI は `UI/src/chat/sessions/SessionItem.tsx:55` / `:160`。

検証・判定：FAIL。正常復元・Fork 後送信・元保存保持・移動・UI 本体での復元は成功するが、001の失敗後に続行できる契約は明確に破綻。19の本文共有方式、12の参照注入をロードと混同していない。

### Phase 6 バックエンド選択

一次資料ページ ID：`3e34b8edfa4e81cfbab5eebaa06c7594`。

意図・契約：生成ファクトリー分離、選択設定、変更時の会話を初期化する規則、現在バックエンド表示、Codex 回帰成功の5項目。固有の対象外範囲・手動受入の記載なし。設定ファイル変更には再読み込みが必要という現 Manifest 制約を考慮する。

**対応箇所**

- `EH/backends/createBackend.ts:37`
- `session/chatSession.ts:7`
- `session/BackendRuntime.ts:122`
- `webview/backendSettings.ts:13`
- `webview/chatViewProvider.ts:227`
- `UI/src/chat/connection/BackendMenu.tsx:56`。

検証・判定：PARTIAL。6種類の busy 拒否、旧イベントの転送は0件、UI 本体の Pi→Codex→Pi と保存・非混入は成功。002の保存待ち競合あり。設定ファイルを直接変更した再読み込み前に UI が新設定・ランタイム本体が旧バックエンドになる点は文書差異として8節に残す。

### Phase 7 ランタイム軽量化 / UI Contribution

一次資料ページ ID：`3e34b8edfa4e81639fdae3b4619b824a`。

意図・契約：専用 ESM 入口・コード分割・3プロバイダー系統・不要プロバイダー除外・SDK 更新検知。custom プロバイダー/models.json/汎用 OpenAI API は維持。UI は select/toggle/progress、5スロット、Host 条件 AND、Registry、バックエンド Surface、組み込み Factory とユーザー拡張共存。任意 React/JS/CSS、外部公開 Registry API、ローカル専用 UI 等は対象外。

**対応箇所**

- `config/runtime/pi-entry.mjs:3`
- `config/package-pi.cjs:66`
- `pi-bundle-plugin.cjs:21` / `:102`
- `pi-sdk-contract.cjs:8`
- `EH/backends/pi/PiRuntime.ts:647`
- `PiProviders.ts:7`
- `SH/uiContributionSchemas.ts:93`
- `EH/ui-contributions/UiContributionRegistry.ts:24`
- `contributionConditions.ts:13`
- `UI/src/contributions/ContributionRenderer.tsx:11`。

検証・判定：PASS。現メタデータは47出力・6,151,822 bytes、対象プロバイダー/4 API/dynamic OAuth/MCP chunks を確認。配布 SDK・ローカル custom API・tool_search/codemode 製品経路は成功。3つのクラウドとの実際の通信、画像ワーカーのすべての資産に対する専用の受入、新旧 VSIX 比較は未実施。後続17の openai 移行と16系の配置移動を回帰に数えない。

### Phase 8 プロバイダー操作 / ライブモデルカタログ

一次資料ページ ID：`3e34b8edfa4e8178be0fd8c782985c72`。

意図・契約：Model/通常推論/Ultra/Fast/使用量を能力別に公開し、秘密値を Host に留め、モデル変更・認証変更・取り消し・取得失敗に整合させる。固有状態と SDK 標準値を分離し、補助取得失敗は基本会話を妨げない。独自モデル合成、未知推論公開、永続カタログ、他社 live、クレジットは対象外。手動で確認する条件は能力差・狭幅明暗・送信値。

**対応箇所**

- `EH/backends/pi/PiAccount.ts:95` / `:218`
- `PiModelOptions.ts:41`
- `PiProviderControls.ts:91`
- `openai/OpenAIProviderControls.ts:61` / `:158` / `:178`
- `OpenAIModelCatalogService.ts:20`
- `OpenAIQuotaService.ts:56` / `:100`
- `ui-contributions/builtinContributions.ts:32`。

検証・判定：PARTIAL、004。通常の SDK 候補、実際の引数/エンドポイント一致、priority 要求、使用量の401/403限定 CLI 代替処理と source 表示を確認。実サービスでの OAuth / 更新 / 本サービス使用量 / 高速実処理は未実施。Ultra は17の Host 委譲方式、候補は17冒頭の公開共通部分を現在仕様とする。旧推論レベル=ultra 不在は不具合にしない。

### Phase 9 Zod 通信 Schema 整理

一次資料ページ ID：`3e34b8edfa4e8147b960d826551d1c86`。

意図・契約：Zod 4から型を導出し、`control` union、ID/一意性/toggle/progress 条件を集約する。従来 Composer の緩い条件、未知キー、元オブジェクト・ネスト参照を保持する。全通信/Host 内部の一括移行、全面厳密化、protocol 再設計、Zod Mini は対象外。UI/導入サイズ比較は受入記録の対象。

**対応箇所**

- `SH/composerSchemas.ts:5` / `:18` / `:28` / `:36`
- `composer.ts:11`
- `uiContributionSchemas.ts:11` / `:69` / `:93` / `:126`
- `composerValidation.ts:15`
- `uiContributionValidation.ts:7`
- `stateFieldValidation.ts:14`
- Host と `UI/src/bridge/vscodeBridge.ts:120` は受信検証後に元値を配信する。

検証・判定：PASS。メモリー上で35アサーションを実行した。空 ID、絵文字境界、重複、未知の `control` / `when`、同値の `toggle`、`NaN` / `Infinity` を確認した。Composer の緩い条件、未知キーと参照の保持、Host への patch 委譲も確認した。新旧実装への同一入力の比較・当時サイズの再現は未実施。継続保護不足は009。

### Phase 10 `ModelRuntime` 統一 / 能力情報の補完

一次資料ページ ID：`3e44b8edfa4e8186b2b9e6b86a297a70`。

意図・契約：当初は SDK の候補だけを採用基準としていた。ライブ一覧は表示名・並び順・Ultra・Fast の補助に限定し、未掲載または hide でもモデルを残す。通常推論は SDK に委譲し、認証変更でキャッシュを破棄する。使用量の取得失敗とは分けて扱う。独自レジストリ、ライブ一覧だけにあるモデルの合成、SDK の独自分岐、能力推測、他社の能力情報の補完は対象外。

**後続仕様と対応箇所**

- 17の実測記録が公開モデルの SDK/live 共通部分を明示した
- `EH/backends/pi/PiModelCatalogService.ts:68`
- `PiAccount.ts:101` / `:134` / `:150` / `:263` が選択 UI と Host を揃える
- 通常推論は SDK
- `client_version` は CLI 版と独立。

検証・判定：SUPERSEDED。残存責務は現在8/17として評価。service / account 本体のメモリー確認で未掲載/hidden 候補の除外、`new`→`old` 調整、正常空カタログの候補0/auth-required を確認。旧仕様だけでこれを Bug にしない。004は失敗時の別不具合、014は文書矛盾。

### Phase 10-1 推論レベル上書き / Configuration Update

一次資料ページ ID：`3e44b8edfa4e81659e02ef9b11e4560c`。

意図・契約：旧 `openai-codex` で基準状態を固定し、信頼された `configuration_update` と固定指定を扱う。変更順序・重複防止・モデル変更と、resume / Fork / compaction 後の復元が要求された。明示能力と公式エンドポイントが条件。未知能力の推測、全プロバイダー適用、SDK の独自分岐は対象外。実際のキャッシュ命中率は当時も未確認。

**後続仕様と対応箇所**

- 17が `CodexReasoningOverride` と旧プロバイダー撤去、通常推論の SDK 委譲を指定
- 現在 `EH/backends/pi/PiProviderControls.ts:102`
- `openai/OpenAIProviderControls.ts:158`
- `PiAccount.ts:175` / `:290`
- `PiSessionStore.ts:246` を使う
- 旧識別子がないことは欠落ではない。

検証・判定：SUPERSEDED。SDK 1.0.0 のメモリー上の履歴で、変更後の `high` が compaction エントリー後・再構築後・Fork 後も保持されることを確認した。HTTP 通信での推論切替、compaction 本体の成功・失敗、キャッシュ効果は未確認。旧固定指定を復活させる修正は不要。

### Phase 11 Sandbox / Approval Architecture

一次資料ページ ID：`3e44b8edfa4e81468961da4f7a65434d`。

意図・契約：承認済み Pi PowerShell を同梱 Codex コマンド/exec→Windows Sandbox へ接続。固定 argv/env/cwd/タイムアウト、代替処理禁止、外部読み取り許可・外部書き込み/削除拒否、Stop 子孫回収、SDK 資源/拡張/子の安全経路。C01〜C15 の受入を要求。完全ネットワーク隔離、Host file/信頼済み JS 完全隔離、詳細コマンド解析は対象外/既知制約。

**対応箇所**

- `EH/backends/pi/PiPowerShellTool.ts:58`
- `runtime/PowerShellCommand.ts:26`
- `backends/codex/CodexSandboxExecutor.ts:50` / `:92` / `:102`
- `security/AgentAccessPolicy.ts:62`
- `ApprovedToolCall.ts:73`
- `PiFileTools.ts:103`
- `PiChildRuntimes.ts:69`
- Trust は11-2の前段制約を適用する。

検証・判定：UNVERIFIED。今回の新 VSIX/Codex 本体0.160.0/準備済みの elevated 環境で、許可書き込み・外側書き込み拒否・子孫 Stop は成功。現在試験は native Node と直接実行許可を使う。

追加差分未コミットという古い説明は、`7b63b4f3bf35fec8b97012416386395342f7cfd3` が HEAD 祖先であることから解消済み。Windows `assert.rejects` の結果形式懸念は実機で再現せず、指摘から撤回した（7節）。

### Phase 11-2 ワークスペース Trust / External Code Trust

一次資料ページ ID：`3e44b8edfa4e81c18837f5d12d8fa59d`。

意図・契約：canonical ルート・identity・最深ルート・外部複製キャッシュ未信頼を Host 保存し、人間だけが昇格。未信頼の変更/実行を Approval/Jev 前で拒否、取り消しを親子・未使用の実行許可へ反映。Codex 内部の各ツール追加 Trust、UNC、汎用出所台帳、Quarantine、信頼済み JS の完全隔離は対象外。

**対応箇所**

- `EH/security/WorkspacePathPolicy.ts:37`
- `trust/WorkspaceTrustStore.ts:106`
- `TrustCommands.ts:86` / `:115`
- `TrustGate.ts:44`
- `TrustRepositoryBoundary.ts:7`
- `backends/pi/PiWebTrust.ts:18`
- `PiExtensionTrust.ts:15`
- `PiResources.ts:60`
- `mcp/PiMcpGate.ts:129`。

検証・判定：PARTIAL、003。Store / Gate のメモリー実行で保存再生成、大小文字、UNC 拒否、未登録内側ルート拒否、読み取り許可、取り消し `signal`、破損保存拒否を確認。製品 revoke 後の古い許可拒否と UI 本体での信頼操作も成功。公開複製、ジャンクション実体差し替え、実際の外部拡張取り消しの全受入は未実施。

### Phase 12 セッション参照 / Handoff Context

一次資料ページ ID：`3e44b8edfa4e8139986fe1f9d776dadb`。

意図・契約：`#session` は原文、`#handoff` は自己完結した要約を現在会話へ untrusted 注入。最大5件、同一 cwd/self 除外、ID+`mode`、Pi 最新 compaction と保持範囲、`goal`、失敗時に原文へ自動で代替することの禁止。handoff.json のモデル/推論/既定120秒/取り消し。作業先移動、Pi native handoff、`trusted` system 化、compaction UI は対象外。

**対応箇所**

- `SH/sessionReferences.ts:55` / `:70`
- `EH/session/SessionReferenceContext.ts:9`
- `HandoffContext.ts:30`
- `HandoffDeadline.ts:5`
- `backends/pi/PiSessionContext.ts:5`
- `PiSessionStore.ts:146`
- `backends/codex/context/sessionContext.ts:35`
- `handoffGeneration.ts:7`
- `CodexSubmission.ts:125`。

検証・判定：UNVERIFIED。Pi SDK 本体/ローカル HTTP で原文/要約失敗時に親へ送信しないこと、期限/空/事前中止/compaction 分岐の5条件をメモリー確認。Codex 専用 ephemeral read-only/承認拒否/取り消し接続は静的確認だが、現在の生成・取り消し受入を実行していない。2MB/20ページと Pi 全文照合・同期 SDK の open は制約。チップの「開く」は原文表示で、生成要約のプレビューではない。

### Phase 16 Storybook モック / State Transition 整理

一次資料ページ ID：`3e94b8edfa4e81a0998bc163f2fc1e92`。

意図・契約：主要状態を維持して、Storybook を UI 本体/検証データ/送信記録/明示応答へ限定。本番コントローラーが遷移の基準。固定イベント script、独立画面の編集 buffer は許容、送信補正・保存/信頼/世代判定の複製は禁止。すべてのストーリーの E2E/SDK ブラウザ起動/大規模 design は対象外。

**対応箇所**

- `UI/stories/chat/mocks/storyBridge.ts:14`
- `mockBridge.ts:11`
- `piBridge.ts:6`
- `piApprovalBridge.ts:6`
- `piHistoryBridge.ts:5`
- `fixtures/chatState.ts:21`
- `StoryChat.tsx:7`
- 主要受付/失敗/承認の play は送信メッセージを確認して注入する。

検証・判定：PARTIAL、007。主要ブリッジ・Header 独自保存・値補正は撤去済み、108件の描画・操作に成功。本番の UI 本体の接続も確認。インライン性格設定/認証エディターの状態導出が残る。コントローラー担当の欠落は009へ統合。

### Phase 16-1 モノレポ化 / Webview UI 切り出し

一次資料ページ ID：`3ea4b8edfa4e81f2ba3af8c532bfca1a`。

意図・契約：UI / Shared をワークスペースのパッケージへ分離し、内部の相互依存を禁止する。Shared の環境非依存、単一アダプター、公開 subpath、UI 単独操作を要求する。成功時の JS / CSS 同期、テーマの代替処理、dist/webview の維持も含む。Tauri、protocol/コントローラー/Approval/Sandbox 再設計、本番 Vite は対象外。ルート Manifest 維持は16-2で置換。

**対応箇所**

- `pnpm-workspace.yaml:1`
- `packages/shared/package.json:5`
- `SH/bridge.ts:5`
- `UI/src/bridge/vscodeBridge.ts:38`
- `eslint.config.mjs:191`
- `UI/build.cjs:7` / `:27`
- `apps/vscode-nerita/build.cjs:79`
- `UI/src/ui/theme.css:6` / `:160`。

検証・判定：PASS。境界違反 import なし、Node の shared 解決は同じ dist、React は UI の単一系列。UI/app の JS 2,138,228 bytes/CSS 82,294 bytes が完全一致。新 VSIX・実幅289px 明暗の表示/操作を確認。現在 watch 変更伝播と VSCode 変数がすべて未定義の Chat/Guardrails/Workflow 全6ケースは未実行。

### Phase 16-2 VS Code Extension App 分離 / media 資産統合

一次資料ページ ID：`3ea4b8edfa4e81f79eb6eb58f8f1ee5e`。

意図・契約：ルートを全体の実行制御に使い、Host / Manifest / VSIX を app へ移す。識別名を nerita に変更し、UI の media を編集元としてブランド3点だけを dist へ収集する。必要コントリビューション ID・通信・CSP・コントローラー安全意味・dist/webview 契約を維持。旧 identity 互換、node_modules 物理統合、UI/バックエンド再設計、全 tests 移動は対象外。

**対応箇所**

- `package.json:15` / `:31`
- `apps/vscode-nerita/package.json:2` / `:240`
- `config/workspace-paths.cjs:5`
- `package-runtime.cjs:69`
- `apps/vscode-nerita/build.cjs:14` / `:33`
- `.vscodeignore:1`
- `EH/webview/webviewHtml.ts:18`。

検証・判定：PARTIAL、012/013。直接依存の宣言不足は0件、ブランド3点と dist 一致、251ファイル/162.33MB 新 VSIX と Host 本体/UI/OS 成功。watch ブランドだけの変更は静的に監視外、動的素材変更は未実施。schema/runtime の watch 起動時の1回は移動前も同じ制約。重複コマンドは既存。

### Phase 17 Pi 新機能 / ChatGPT 認証 / MCP / コード実行

一次資料ページ ID：`3eb4b8edfa4e81818f06e03b56a8e938`。

意図・契約：新 OAuth、HTTP MCP、tool_search/codemode、保存前の結果変換を Host の Trust/Approval/Permission/Stop へ接続。動的登録/実際の引数/親子権限、60秒等有限制限、秘密・バイナリ除去、遠隔結果不明、配布/Host 本体/サービス受入。stdio は Docker 上流追跡へ移管、MCP 管理 view・モデル直呼出し・画像/分類専用 UI・複数アカウント自動切替は対象外。

**対応箇所**

- `config/pi-bundle-plugin.cjs:24` / `:114`
- `EH/backends/pi/PiAuthService.ts:111`
- `openai/OpenAIProviderControls.ts`
- `mcp/PiMcpGate.ts:87` / `:129`
- `PiMcpServer.ts:303`
- `PiApprovedTools.ts:33`
- `PiToolFeatures.ts:187`
- `config/pi-codemode-limits.cjs`
- `results/PiStructuredDisplay.ts`。

検証・判定：PARTIAL、004/005/014。SDK 1.0.0・秘密の除去・保存・復元・通常/検索/コードモード・子書き込み・MCP deny/error/lost・実際の認証エディターの閉鎖を確認。実サービスでの OAuth の新規認証・更新、認証付き MCP サーバー本体、正式使用量/priority 実処理は未実施。Ultra は Host 委譲、Fast は priority 要求であり高速実現保証ではない。CLI 補助使用量は Pi OAuth の同一アカウント取得を保証しない。

### Phase 18 テスト環境の再構築

一次資料ページ ID：`3ec4b8edfa4e81a491bcd3c65661b0f4`。

意図・契約：SDK 本体/本番コントローラー/保存後の独立した復元/Host/OS/UI/VSIX ごとにテストの担当を再設計する。新しいテストが成立してから旧体系を撤去する。受入条件は、正常な基準状態での成功と変異テストでの目的のアサーション失敗、準備失敗の除外、環境不足を成功と判定しないこと、重要な失敗経路の継承である。件数維持/削除率目標/未対応機能の有効化は対象外。

**対応箇所**

- `config/test-products.cjs:16` / `:75` / `:115`
- `product-regressions.cjs`
- `test-distribution.cjs`
- `test-webview.cjs`
- `tests/support/pi.ts:31`
- `codex.ts`
- `restoredState.ts:10`
- Pi は本番コントローラー+同梱 SDK 本体+ローカル HTTP、Codex は本番 Client/コントローラー+`AppServer` スタブ、Codex 本体は別 OS/配布担当。

検証・判定：PARTIAL、008/009。製品テスト79件、ストーリーテスト108件、10種類の変異テストの失敗検出に成功した。展開した VSIX、UI 本体、準備済みの OS 環境でも検証に成功した。各テストがどの境界を代替しているかを確認した。旧テストの保護の欠落と、検出判定の誤った成功は、成功件数では解消しない。

### Phase 19 ツール出力の軽量化 / 遅延読み込み

一次資料ページ ID：`3ed4b8edfa4e81ae8b90ff4eb0bd902e`。

意図・契約：先頭・末尾の約2,000文字のプレビュー、内部構造を公開しない参照、最大64 KiB の UTF-8 バイト範囲と `nextOffset`・不正値の拒否・1範囲の保持。保存結果を基準に不足する完了済みの子/シェル本文を追加し、復元/Fork/missing/truncated を正確に扱う。SDK 同期 open/全エントリー、未完了/テキスト以外/別ランタイムの子、本文回収、長時間負荷等は継続課題7件の対象。

**対応箇所**

- `SH/toolOutput.ts:7` / `:38`
- `EH/session/ToolOutputStore.ts:72` / `:111` / `:248`
- `ToolOutputWriter.ts:19`
- `statePublisher.ts:39`
- `backends/pi/results/PiToolOutput.ts:10`
- `PiOutputArchive.ts:68` / `:143` / `:168`
- `backends/codex/history/restoreHistory.ts:64` / `:119`
- `AppServerJsonReader.ts:55`
- `PiSessionHeader.ts:7`
- `UI/src/chat/tools/ToolOutputView.tsx:75`。

検証・判定：PARTIAL、006。出力/UTF-8 の正常な境界/失効/保存失敗/再起動/Fork/Codex 複数 page/Worker の実行と、UI 本体での出力・復元・Fork 成功。本文欠損時はプレビュー維持・参照無効。継続課題を未実装の指摘にしていない。外側折りたたみ時の解放と実際の長時間負荷は7節。

### Phase 21 日本語校正スキル / AI スロップ検出強化

一次資料ページ ID：`3ee4b8edfa4e81ef9bd1c93be426b1bd`。

意図・契約：高確度の `ai-slop-pattern` は通常の lint を失敗させ、文脈確認が必要な `ai-slop` はレビュー候補とする。既存のレビュー用データ/検査対象外の範囲/指摘 JSON v2/最大20件の出現例は維持する。意味の一致を優先し、自動置換/AI の点数化/専門語の強制置換/`yomiyasu` への実行時依存は対象外とする。既存101件の文章修正・全体の lint 成功は別作業である。全候補を意味に基づいて分類することが手動の確認条件である。

**対応箇所**

- `.agents/skills/japanese-proofreading/config/textlint-slop.json:2`
- `scripts/textlint-slop.mjs:5`
- `textlint.mjs:271` / `:390` / `:504`
- `textlint-audit.mjs:172` / `:196` / `:243`
- `textlint-protected.mjs:55`
- `references/Proofreading.md:34`。

検証・判定：PARTIAL、010/011。専用6+3テスト成功、通常/review×all/changed の明示ファイル CLI、severity/保存/上限と2保護不具合を実行確認。HEAD 差分の自動選別・リポジトリ全体意味分類・101件の現件数は再確認していない。製品 pnpm check とは別の検証である。

## 6. 実施した検証

### 実行環境と境界

Windows x64、開発 Node.js `v24.21.0`、pnpm `12.3.4`、VS Code 本体 `1.140.0`。同梱 Pi SDK は `@earendil-works/pi-coding-agent 1.0.0`、Codex は `0.160.0`。開発・配布のログはこの環境の結果であり、Notion に残る旧版の成功件数を加算していない。

すべてのシェル操作は RTK 規約を読了した後、`rtk` を先頭に付けて実行した。表は再実行しやすい製品コマンドを示す（実行時は `rtk proxy pnpm.cmd ...`）。Notion は専用コネクターで読み取った。Git の状態・差分・変更履歴と、Shared / Host / UI / SDK のソースを照合した。Manifest・ビルド・監視・ランタイムの配布処理、現在のテストと削除前の履歴も照合した。

| コマンド | 今回の結果 | 支持できる範囲 |
| --- | --- | --- |
| `pnpm check` | exit 0、エラー/警告なし | ESLint、Host/Shared/UI/Stories/Tests 型チェック |
| `pnpm test` | 79 pass、0 fail、0 スキップ、準備・終了処理を含めて7.1秒 | 現製品経路とローカルモデル・スタブ境界 |
| `pnpm test:storybook` | 33 files / 108 tests pass、exit 0 | Chromium での実コンポーネント表示・play。バックエンドの実際の認証結果ではない |
| `pnpm test:regressions` | 基準状態の79件成功、10種類検出、29.0秒、exit 0 | 変異テスト版の失敗を観測。目的アサーション照合に008の限界 |
| `pnpm test:distribution` | 新 VSIX 251ファイル/162.33MB、同梱 SDK 79件成功、Host 本体起動成功、exit 0 | 今回の配布成果物・公開コマンド・SDK 入口 |
| `pnpm test:webview` | 新 VSIX から UI 本体受入成功、exit 0 | Trust 操作、接続、承認前未書き込み/許可後書き込み、Stop 後未書き込み、認証エディターの閉鎖、バックエンド往復、履歴・出力復元/Fork |
| `pnpm test:windows` | 新 VSIX、許可書き込み/外側書き込み拒否/停止時の子孫回収に成功、exit 0 | 準備済みの elevated 環境と Codex 本体の OS 境界 |
| `node --test .agents/skills/japanese-proofreading/tests/textlint-slop.test.mjs` | 6 pass / 0 fail / 0 スキップ | スロップ分類・既存保存契約 |
| `node --test .agents/skills/japanese-proofreading/tests/extractors.test.mjs` | 3 pass / 0 fail / 0 スキップ | 既存抽出の代表例 |

package は各配布コマンドの prepublish から実行され、型/lint、Shared build、本番 UI、Host/runtime 生成を通った。`pnpm compile` や `pnpm build` を成功件数のためだけに重複実行していない。distribution/webview 内の追加79件実行はスクリプトの必須手順であり、別の機能件数として足していない。

Storybook 実行時の Vite native config loader の将来互換警告、VS Code 自身の proposal/非推奨 API 警告があった。現在の成功を覆す実行不具合は示していない。Nerita の重複コマンド警告は013として分離した。

### UI 画像と観測

今回の成果物は `dist/ui-review/nerita-distribution-dgTrBi/` にある。以下の画像を実際に開いて確認した。

- `approval.png`、`stopped.png`、`auth-pending.png`
- `backend-switched.png`、`restored.png`、`last.png`
- `output-live.png`、`output-restored.png`、`output-forked.png`

対象状態で承認・Stop・接続表示・復元・範囲ビューの描画を確認した。今回の受入では、Webview のコンソールエラーとページエラーがないことを検証した。

`viewport-vs.json` / `viewport-vs-dark.json` の実幅はいずれも289px。light は背景 `rgb(250,250,253)` / 前景 `rgb(32,32,32)`、dark は背景 `rgb(25,26,27)` / 前景 `rgb(191,191,191)`。VS Code 変数が存在する条件の実際のテーマ適用であり、変数がすべて未定義の場合の保証へ拡張しない。`trace.zip` も保存した。動画・長時間性能・全アニメーション中間状態は確認していない。

### 最小再現

大量のテストコードを新設せず、各担当が製品 TS の `esbuild write:false`、vm、SDK 本体メモリー実行を用いて以下を確認した。再現で代替した境界は指摘内に明記した。

- 本番コントローラー+寿命管理処理の切替失敗後の続行、バックエンド設定保存待ちの送信競合。
- TrustStore / Gate 本体の保存失敗と復旧、canonical/取り消し/破損値の代表条件。
- カタログ本体 reader/service の5秒タイムアウトと成功キャッシュ失効、候補の共通部分。
- `readRange` 本体の不正 UTF-8、回帰テストの判定関数の無関係アサーション受理。
- 現 Schema/ガード 35 アサーション、Handoff 期限/取り消し/選択5条件、SDK 通常推論の compaction/再構築/Fork 保持。
- 校正 CLI 4モードと保護領域2ケース。OS の一時領域のみを用い、製品とリポジトリキャッシュを書き換えていない。

グラフは HEAD 一致を確認したが、領域間エッジが空だったので境界の合否はソース本体で決めた。グラフの警告0を安全性の証拠にしていない。

## 7. 未確認事項

| 項目 | 理由と判定への影響 |
| --- | --- |
| Pi Steer の連打・Stop 直後・遅い受付完了競合・保存復元 | 現スイートは通常反映が中心。Phase 4は UNVERIFIED、009へ継続保護不足を統合 |
| Codex handoff 生成・生成中 Stop、長い実際の履歴の要約品質と継続 | ソースは接続しているが現在の直接受入を実行していない。Phase 12は UNVERIFIED |
| 新 ChatGPT OAuth 実際のログイン/更新、実サービスの使用量、priority 高速実現、認証付き外部 MCP | 実際のアカウント・外部サービス試験を今回は実施していない。ローカル/スタブの成功と区別 |
| 導入済外部 Pi 拡張・公開 pi-web-access 複製・すべての取り消し競合 | `pnpm test:external` は未実施。過去の拡張本体記録は今回へ流用しない |
| 信頼ルート実体/ジャンクション差し替え・ハードリンクをツール本体の承認待ちに変更 | 現在のテストの欠落を確認したが、今回は実際のファイル差し替えの全経路を再現していない |
| watch 伝播・ブランド単独更新、画像 worker すべての資産、すべての manifest icon/F5 | static/build/配布は確認。製品ファイルを一時変更して watch の全入力を検証していない |
| VSCode 変数未定義の Chat/Guardrails/Workflow 明暗6ケース | 今回の UI は VSCode 実際のテーマ。古い成功画像を今回の証拠にしない |
| 遅い多チャンクの実際の画面ストリーミング、すべてのツール UI、長時間性能・低速ディスク | 一括 SSE のローカルモデル、選択シナリオと短時間の出力受入に限定 |
| 校正リポジトリ全体意味分類・既存101件・HEAD 差分の自動選別 | 明示ファイル CLI と専用テストを実行。全体成功は Phase 21自身も範囲外 |
| 変更のない HEAD のビルド/画像 | UI の既存ステージ済み変更込みで検証。clean main の画像受入と呼ばない |

### 証拠が不足する調査候補

次は確定した指摘に含めない。

- 外側の `ToolCard` を閉じた時の範囲解放：`UI/src/chat/tools/ToolCard.tsx:113` は本文をマウントしたままにする。`ToolOutputView.tsx:56` は自身の `expanded` に応じて範囲を解放する。詳細ビュー自身を閉じれば解放される。外側の折りたたみも「ビューアーを閉じる」契約に含むかは未確定である。64 KiB を保持する影響も未確定である。
- Windows 拒否結果形式の判定：`tests/vscode/sandbox.ts:71` / `:79` は Promise の拒否を期待する。終了コードが0以外でも Promise が成功する仮定のメモリー例ではアサーション失敗になるが、今回の VSIX 本体の試験では書き込み拒否・後段子孫 Stop まで成功した。現在の OS 受入不具合としては撤回する。
- 認証スナップショットの競合：OpenAI の同期 OAuth スナップショットと非同期確認の間の外部変更は候補。通常の製品認証経路の障害を再現していない。
- 参照処理の巨大履歴負荷：Pi 全文前後照合と SDK 同期 open、Codex 2 MB/20ページ上限がある。lazy ツール出力完了を履歴参照全体の非同期化と解釈せず、未計測の性能悪化を Bug にしない。

## 8. 仕様・文書とのずれ

014のモデル候補の採用基準の矛盾は、後続実測で明示した変更を優先して判定した。Phase 10-1の撤去、16-1のルートの Host / Manifest を維持する仕様から16-2の app 分離、Phase 19の本文追加保存も同様に正当な後続変更として扱った。

次の差は文書同期の対象であり、実装漏れと即断していない。

- Phase 1/2/3/5/6/16等で状態「実装済み」と未チェック欄が共存する。Phase 18にも未チェック工程が残る。コード・実行を評価し、未チェックだけで FAIL にしていない。
- Phase 11は状態「実装済み」でも本文・概要が全体未完了を明記する。追加差分未コミットという部分は現 Git では解消済み。古い作業記録パスと現ツリーの差もある。
- Phase 4の「未コミット」や旧テストコマンド/件数、親統合ページの旧 `src/extension` / `src/webview` 構成は歴史記録。現配置の欠落として扱わない。
- Manifest は設定ファイルのバックエンド変更後に再読み込みを要求する一方、`chatViewProvider.ts:61` / `:79` は新設定を即時表示へ通知する。再読み込み前に `advertised=pi / actual=codex`、同値再選択でも再起動しないことをメモリー確認した。「現在バックエンド」の意味を、設定値/実接続/再読み込み待ちのどれかへ揃える必要がある。再読み込み仕様を踏まえ、002とは別の主要 Bug として数えていない。
- Pi SDK 1.0.0、Codex 0.160.0は Phase 17等の旧版記録と異なる。名前・版が違うだけでは回帰と判定していない。Fast の要求 priority と返却 default、CLI 補助使用量の取得元/アカウント非保証は現在の既知制約。
- Phase 19の継続課題 7件、Phase 21の既存文章修正/全体 lint 未通過は、該当フェーズで実装完了とした範囲の外。新規指摘と区別した。

## 9. 推奨する対応

### 1 修正必須

1. 001：Pi 会話切替の元ランタイムを切替成功まで保持し、失敗後続行を SDK 本体経路で検証する。
2. 002/003：バックエンド保存待ちの会話受付と Trust 保存失敗後の復旧を修正し、表示・実効状態を一致させる。
3. 004/005/006：カタログ内部の取得期限を過ぎた場合の成功キャッシュ利用、MCP 結果不明の契約、不正な UTF-8 の拒否を修正する。保存復元/Fork/子要約にも状態を通す。
4. 008/009：目的のアサーションとの照合と、重要な失敗経路を検証するテストを整備する。全スイートの成功をリリース判断の根拠とする前に、検出能力の範囲を明確にする。

### 2 追加検証推奨

1. Steer 競合、Codex handoff/生成中 Stop、承認中の対象変更/リンク差し替えを既存担当へ追加する。大量の旧試験復元は不要。
2. 実サービスでの OAuth 更新、正式使用量/priority、認証付き MCP サーバー本体、外部拡張 Trust を必要なサービス環境で確認する。ローカル成功から推定しない。
3. watch と VSCode 変数未定義の全画面、長時間ツール出力を別の短い受入へまとめる。

### 3 設計整理

1. 007：残る Storybook インラインハンドラーを送信観測と固定 DTO 注入へ整理する。
2. 010/011：校正のコードフェンス/参照リンク保護を Markdown の境界に合わせる。
3. 012/013：ブランド3点の watch 入力とコマンド宣言を整理する。
4. MCP の送信前拒否/確定失敗/結果不明、バックエンドの設定値/実接続、Trust の保存値/実効値を同じ表示語で曖昧にしない。

### 4 文書同期

1. 014：Phase 10の置換範囲と Phase 17の候補基準、取得失敗/空一覧を統一する。
2. Phase 11の状態・追加差分のコミットを現在の実装と未検証に揃える。
3. 初期 phase の未チェック欄、旧コマンド/配置/版を歴史記録と現契約に区別する。

元の実装レビューでは製品を修正せず、Notion の更新や Issue の作成も行っていない。本報告書は未対応指摘、未検証条件、後続仕様による置換の判断を次の作業へ引き継ぐ記録として残す。

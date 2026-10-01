# テストポリシー監査・対応マーク

監査日: 2026-10-01。対象は `ab70a5e96d42bf913b97028551027c3717a3aa27` 上の未コミット変更・未追跡ファイルを含む作業ツリー。

## 判定

**ケース単位の結論は[必要性の再監査](Testing-Necessity-Review-2026-10-01.md)を参照。** Host 側の721ケースから、削除12ケース、統合10ケース、修正15ケースを特定した。残る684ケースは維持判定保留であり、残す根拠の監査は未完了。

本書には初回の15項目を記録する。内訳は修正11項目、統合2項目、削除2項目。初回の「削除2件」はアサーション群への指摘であり、721ケースを必要性で選別した結果ではなかった。以下のマークは対応方針であり、テストや製品コードの変更は行っていない。

主な問題は、制限を削除しても成功する拒否試験、検証本体まで到達できない受入スクリプト、入力条件と実際の画面状態が一致しない明暗試験、層ごとの固定入力だけで完結する結果変換試験だった。

[テストポリシー](../../.agents/docs/Testing-Policy.md)の「このテストがなければ、どの具体的な不具合を見逃すか」を判断基準とした。固定データそのものを違反とせず、実装を壊したときに失敗するか、実際の接続を通るか、継続して実行できるかを確認した。過去に成功したことや、ファイルが残っていることを維持理由にしない。

## 範囲と証拠の扱い

フェーズ17に限定せず、次の174ファイルの配置・実行入口・検査の形を横断調査し、候補箇所は実装と呼出先まで確認した。全174ファイルの全ケースについて、不具合を検出する能力を実証した監査ではない。

| 範囲 | ファイル数 | 調査した主な責任 |
| --- | ---: | --- |
| `tests/unit` | 95 | 入力検証、承認・信頼、保存、変換、UI 状態、ワークフロー |
| `tests/contract` | 2 | 通信スキーマ、保存先の契約 |
| `tests/integration` | 5 | 実 SDK、HTTP MCP、検索・コード実行、設定と推論 |
| `tests/e2e/ui-review` | 61 | ユーザー操作、状態表示、テーマ、描画 |
| `tests` 直下の Node テスト | 10 | 配布・更新、ライセンス、引継ぎ、文書検査ツール |
| `tests/extension.test.ts` | 1 | 実 Extension Host と VS Code の境界 |

加えて、受入スクリプト、共通の準備処理、Storybook の設定・ストーリー、[実行コマンド](../../package.json)を調査した。[前回の監査](Testing-Policy-Audit-2026-09-30.md)で修正済みの期待値計算・重複などは、現在の実装を確認せずに再指摘しない。

以下では証拠を区別する。

- 実行確認: 今回実行して結果を確認した。読込み時の変換で不具合を注入する検証では、元の製品ファイルは変更していない。
- 静的確認: 入力、実装、アサーションを照合した。示した反例は修正後の担当テストが検出すべき条件であり、すべてを実行済みとはしない。
- 既報＋再照合: フェーズ17の再現報告と現在のコードを照合した。今回再実行していない再現結果を、新しい実行結果に数えない。

## 対応一覧

優先度「高」は、安全境界の誤判定、受入入口の不成立、既知の製品不具合を見逃すもの。「中」は検証内容と主張の不一致や重複。「低」は内部実装への過剰な固定とする。

| ID | マーク | 優先度 | 対象 | 問題 |
| --- | --- | --- | --- | --- |
| R01 | **修正** | 高 | 受入スクリプト4本 | 相対パスの起点が誤り、ビルドで停止する |
| R02 | **修正** | 高 | `referenceClipboard.test.ts` の巨大入力 | サイズ制限を外しても、不正 JSON として拒否される |
| R03 | **修正** | 高 | `jevGuard.test.ts` の `large` | 上限拒否と構文エラーを区別しない |
| R04 | **修正** | 高 | `openAIModelCatalog.test.ts` の `size` | 空白だけの入力で上限を検証したことにする |
| R05 | **修正** | 高 | `piMcpConfig.test.ts` の巨大ファイル | 不正 JSON と別の設定不備が検証条件に混在する |
| R06 | **修正** | 中 | `textlint-audit.test.mjs` のレビュー保存 | 保存本文・位置情報をすべて失っても成功する |
| R07 | **修正** | 高 | 明暗を列挙する UI 試験 | 40ファイルと別の1ケースでテーマ指定が不足する |
| R08 | **修正** | 中 | 認証エディターの Extension Host 試験 | 「取消で閉じる」の終了結果を確認しない |
| R09 | **修正** | 高 | `sandbox-smoke.mjs` の W08 | 停止・時間切れ・正常終了を区別せず成功にできる |
| R10 | **修正** | 高 | 通常ツール結果の結合試験 | 検索・コード実行の有効化と大きな結果の組合せが抜ける |
| R11 | **修正** | 高 | HTTP MCP の404・401・Stop 試験 | 結果不明と通常の失敗、履歴への保存を確認しない |
| M01 | **統合** | 中 | MCP 結果・表示・履歴の分断した検査 | 実際に受け渡される形式の担当が不在 |
| M02 | **統合** | 中 | Pi 承認 UI の全組合せ | 同じ応答操作を表示条件ごとに重ねる |
| D01 | **削除** | 低 | 実行状態アイコンの具体的な SVG クラス検査 | クラス名だけの変更で失敗する |
| D02 | **削除** | 低 | 更新試験の成功時の書込み回数 `3` | 出力内容を保証せず、内部の書込み構成を固定する |

## 修正対象

### R01: 受入スクリプトの実行入口

対象は次のビルド入力と解決起点。

- [sandbox-smoke.mjs](../../tests/sandbox-smoke.mjs) の24–41行。
- [pi-shell-smoke.mjs](../../tests/pi-shell-smoke.mjs) の20–31行。
- [pi-subagents-package-smoke.mjs](../../tests/pi-subagents-package-smoke.mjs) の11–34行。
- [pi-web-access-smoke.mjs](../../tests/pi-web-access-smoke.mjs) の19行・102–104行。

**実行確認。** `extensionPath = extensionRoot` を `resolveDir` に渡している。一方、ビルド入力では `./apps/vscode-nerita/src/...` や `./tests/...` を指定している。[workspace-paths.cjs](../../config/workspace-paths.cjs)の `extensionRoot` はすでに `apps/vscode-nerita` を指す。このため、ディレクトリ名が重複した場所や、拡張機能配下の存在しない `tests` を探す。

4本それぞれの実ファイルからビルド入力を取り出し、同じ起点で書込みなしのビルドを実行した。4本すべてが `Could not resolve` で失敗した。外部パッケージの導入や認証が満たされても、このビルドに到達すると検証本体へ進めない。実際の外部接続・サンドボックス実行までは行っていない。

担当と完了条件: 各スクリプトの起点をリポジトリの起点と拡張機能の起点に使い分ける。`test:sandbox`、`test:pi:shell`、`test:pi:subagents`、`test:pi:web` から本体が実行され、環境不足とケース失敗を分けて報告できること。ビルドだけの成功を受入完了にしない。

### R02–R05: サイズ制限を検証できない拒否データ

**実行確認。** 読込み時の変換で下表の4つの上限判定を `false` に置き換え、対応する4ファイルを実行した。変換がすべて適用されたログを確認した。**変更前と制限無効化後は、どちらも35件すべて成功した。** 上限を無効にする回帰を検出できていない。

| ID | 対象と現状の入力 | 無効にした製品の判定 | 修正後の入力と観測結果 |
| --- | --- | --- | --- |
| R02 | [referenceClipboard.test.ts](../../tests/unit/referenceClipboard.test.ts) の38–43行。`x` を4,000,001文字並べる | [referenceClipboard.ts](../../apps/nerita-ui/src/chat/composer/referenceClipboard.ts) の `raw.length > 4000000` | 本文と参照が一致する有効な JSON を空白で調整し、上限以内は復元、超過は拒否となること。本文側の制限とは条件を分ける |
| R03 | [jevGuard.test.ts](../../tests/unit/jevGuard.test.ts) の222行以降。`large` は `x` を32,769文字並べ、例外なら成功 | [JevClient.ts](../../apps/vscode-nerita/src/extension/security/JevClient.ts) の `size > 32768` | 有効な許可応答を上限前後に調整する。上限以内の許可と超過時の安全な扱いを確認し、構文エラーで代用しない。ストリームの分割と UTF-8 のバイト数も担当させる |
| R04 | [openAIModelCatalog.test.ts](../../tests/unit/openAIModelCatalog.test.ts) の34–55行。2 MiB 超の空白だけを返す | [OpenAIResponseBody.ts](../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIResponseBody.ts) の `size > 2 * 1024 * 1024` | スキーマも正しいモデル一覧を空白で調整する。上限以内なら一覧を取得でき、超過なら取得を中断すること |
| R05 | [piMcpConfig.test.ts](../../tests/unit/piMcpConfig.test.ts) の103–122行。`private-data` を反復する | [PiMcpConfig.ts](../../apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpConfig.ts) の `stat.size > 256 * 1024` | 他の設定を正常に戻し、有効な MCP 設定を256 KiB 前後に調整する。正常な設定の読込みと、サイズによる拒否を区別する |

ポリシー上の問題は、目的の制限を通過しても後段の JSON 解析で落ち、同じ期待値になること。各ファイルを担当として拡張し、不正 JSON の検査と上限の検査を混ぜない。上限なしの実装で修正後のテストが失敗することを完了条件にする。

### R06: 文書レビューの保存内容

対象: [textlint-audit.test.mjs](../../tests/textlint-audit.test.mjs) の `writes only requested cache files and clears stale review data`。

**実行確認。** 保存結果の行数が2行であることと、そのファイルを削除できることしか確認していない。[textlint-audit.mjs](../../scripts/textlint-audit.mjs) の305行にある `...item` を読込み時に除去し、本文・ファイル名・行番号を保存しない状態にしても、当該ファイルの4件すべてが成功した。

担当と完了条件: 同じテストで JSONL を解析し、独立に定義した期待値として本文・対象ファイル・位置・種別を確認する。別の対象範囲のキャッシュも置き、指定範囲の削除後に他方が残ることを確認する。行数だけの期待値は内容の検査に置き換える。

### R07: ライトテーマとして実行されない UI 試験

**静的確認。** [Storybook の設定](../../apps/nerita-ui/.storybook/preview.tsx)は9行で `dark2026` を初期値にし、35–48行で DOM の `data-storybook-theme` に反映する。`page.emulateMedia({ colorScheme: "light" })` だけではこの指定を変えられない。

次の40ファイルは明暗のループを持つが、テーマの `globals` 指定がない。パスはすべて `tests/e2e/ui-review/` からの相対パス。

```text
agent-manager.spec.ts       agents.spec.ts              backend.spec.ts
chat-search.spec.ts         chat.spec.ts                composer-changes.spec.ts
composer-code-block.spec.ts composer-controls.spec.ts   composer-copied-code.spec.ts
composer-drop.spec.ts       composer-expand.spec.ts     composer-image-paste.spec.ts
composer-menu.spec.ts       composer-paste.spec.ts      composer-pasted-range.spec.ts
composer-path-paste.spec.ts composer-paths.spec.ts      composer-sessions.spec.ts
composer-symbols.spec.ts    contributions.spec.ts       follow-up.spec.ts
header.spec.ts              loaders.spec.ts             logout.spec.ts
markdown.spec.ts            mcp-command.spec.ts         message-references.spec.ts
permission-content.spec.ts  personality.spec.ts         pi-account.spec.ts
pi-agents.spec.ts           pi-approvals.spec.ts         pi-auth-editor.spec.ts
pi-guardrails.spec.ts       pi-history.spec.ts           pi-workflow.spec.ts
quota-bar.spec.ts           run-status.spec.ts           sessions.spec.ts
sidebar.spec.ts
```

さらに [tool-cards.spec.ts](../../tests/e2e/ui-review/tool-cards.spec.ts) の104行以降の通常カード試験も同じ問題がある。同ファイルの71行以降の構造化結果の試験は明示指定があり、同列に扱わない。[trust-manager.spec.ts](../../tests/e2e/ui-review/trust-manager.spec.ts)は指定があるが、ダーク側に `dark2026` ではなく `dark` を渡しており、意図するテーマとの対応を修正する必要がある。

担当と完了条件: テーマの選択を共通の準備処理に集め、撮影前に要求した属性と実際の色を確認する。ライト側だけに表示不具合を入れたとき、ライト試験が失敗すること。各機能の明暗の表示確認は維持し、色に依存しない操作を毎回全組合せで反復する必要は見直す。

今回、これらの UI 試験の再実行・画像確認はしていない。[フェーズ17の報告](Phase-17-Implementation-Review-2026-10-01.md)では利用枠と通常カードの画像が確認されているが、40ファイルすべての画像を確認した証拠としては扱わない。

### R08: 認証エディターが閉じたかを観測しない

対象: [extension.test.ts](../../tests/extension.test.ts) の認証管理を開いて取り消すケース。

**静的確認。** タブが開いたことを確認した後、`finally` で取り消して待機するだけで、タブの消失を確認しない。待機だけ解決し、実際のエディターが残る回帰を検出できない。[piAuthPanel.test.ts](../../tests/unit/piAuthPanel.test.ts)は VS Code のパネルを差し替えるため、実際のタブ寿命の代替にはならない。

担当と完了条件: この Extension Host 試験で、対象のタブが開いてから取消しを行い、期限内に対象タブがなくなったことを確認する。後片付けと検査対象の操作を分け、検査が失敗しても残ったタブを閉じる。実際のタブを残す不具合を入れたときに失敗すること。

### R09: 子プロセスの終了原因を確認しない

対象: [sandbox-smoke.mjs](../../tests/sandbox-smoke.mjs) の424–459行、`W08 stop/timeout/normal descendants`。

**静的確認。** 子が開始マーカーを作ったことは待っているが、実行の成功・失敗をともに値に変え、その後のカウンターが400ミリ秒変わらなければ成功となる。正常終了のつもりが異常終了した場合や、停止が効かず設定された時間切れで終了した場合も、終了理由を問わない。停止前にカウンターが増えたことも確認せず、未作成を空文字として扱う。

担当と完了条件: この OS 境界の試験で、子孫が実際に動作していることを確認し、停止・時間切れ・正常終了ごとの結果と妥当な所要時間を確認する。その後に子孫の書込み停止を確認する。取消しを無視する実装や、正常終了を異常終了へ変える実装が失敗すること。R01 の入口修正後に実機で検証する。

### R10: 大きな通常ツール結果と機能設定の組合せ

対象: [piToolFeatureSession.test.ts](../../tests/integration/piToolFeatureSession.test.ts) の74行以降、[piToolFeatures.test.ts](../../tests/integration/piToolFeatures.test.ts)の結果上限検査、[piTools.test.ts](../../tests/unit/piTools.test.ts)の画像結果検査。

**実行確認。** 検索とコード実行の結合試験は小さい結果で成功する。コード実行側の出力予算や、[piResultDisplay.test.ts](../../tests/unit/piResultDisplay.test.ts)の要約上限は確認している。しかし、通常ツールへ適用する [PiFeatureToolResults.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureToolResults.ts) の結果保護に、大きな入力を渡す検査が不足している。

本番の保護処理に30万文字の本文または画像データを渡した。両機能が無効なら返却できた。検索とコード実行をそれぞれ単独で有効にすると、本文・画像データの両入力で `SyntaxError` になった。各条件で元のツール実行は1回だった。[PiFeatureSafety.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureSafety.ts) の20–26行が、JSON を262,144バイトで切ってから解析している。画像デコーダーや実サービスを通した再現ではない。

担当と完了条件: 結果保護の境界値は既存の結果試験に集め、実 SDK の配線と保存・復元は `piToolFeatureSession.test.ts` に担当させる。無効・検索単独・コード実行単独・両方の設定を検証する。上限前後、多バイト文字、画像、途中結果と最終結果から、異なる経路を検出する代表例を選ぶ。全層に同じ行列を複製しない。元の操作の結果を失わず、不正 JSON や二重実行を生じないこと。

### R11: MCP の実行結果不明と保存内容

対象: [piHttpMcp.test.ts](../../tests/integration/piHttpMcp.test.ts) の404・401のケースと、信頼取消し・HTTP 応答待ち中の停止のケース。

**既報＋再照合。** 404では何らかの例外と送信回数を確認するだけで、送信後の結果不明を検査しない。401でも表示用のエラー文字列を検査するだけで、テスト名にある履歴は読まない。Stop も例外なら成功する。[フェーズ17の R2](Phase-17-Implementation-Review-2026-10-01.md)で通常の失敗として保存されることが再現されている。今回、この状態保存の再現は実行していない。

担当と完了条件: 同じ HTTP 結合試験で、送信前の拒否、確定した失敗、送信済みで結果が不明な場合を区別する。実 SDK のイベントから共有状態・履歴復元まで確認し、401の秘密を含む本文も保存データに出ないことを確認する。送信回数1回の検査は二重実行を防ぐ契約なので維持する。

## 統合対象

### M01: MCP 結果から表示・履歴までの担当を決める

対象は次の構造化結果に関する検査。

- [piResultDisplay.test.ts](../../tests/unit/piResultDisplay.test.ts) と [piTools.test.ts](../../tests/unit/piTools.test.ts)。
- [piHistoryMapper.test.ts](../../tests/unit/piHistoryMapper.test.ts) と [piHttpMcp.test.ts](../../tests/integration/piHttpMcp.test.ts)。
- [tool-cards.spec.ts](../../tests/e2e/ui-review/tool-cards.spec.ts)。

**既報＋再照合。** 個別試験へ直接 `structuredContent` や完成済みの `resultDisplay` を渡しても、実際の MCP 結果が通る形式を確認できない。HTTP 試験は保存文字列に `count` が含まれることを確認するが、表示元・省略情報の受渡しを確認しない。

[PiMcpTools.ts](../../apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpTools.ts)が生成する `details.resultDisplay` は、[PiResultDisplay.ts](../../apps/vscode-nerita/src/extension/backends/pi/results/PiResultDisplay.ts)の本文優先の分岐で読まれない。この欠落はフェーズ17の R3 で再現され、今回も該当コードが残っていることを確認した。

統合先: `piHttpMcp.test.ts` に「実 HTTP 結果 → 保存前変換 → イベント変換 → 共有状態の検証 → 保存 → 別の読込みによる履歴復元」を担当させる。表示元と省略情報が接続を通って保持されることを確認する。単体側は秘密除去・入力境界・不正な自己申告の拒否、UI 側は表示と操作を担当する。

削除するのは、移管先と同じ固定状態の存在確認を各層で重ねた部分。ファイル全体や固有の安全境界は削除しない。担当を移す際は、どの既存の失敗条件を引き継いだかを確認する。

### M02: Pi 承認 UI の表示と応答操作を分ける

対象: [pi-approvals.spec.ts](../../tests/e2e/ui-review/pi-approvals.spec.ts) の6行以降。

**静的確認。** 2テーマ × 4操作 × 4ツールで同じ応答操作・待機表示・完了状態の投入を繰り返す。表示を変えた32組すべてが、独立した実行・承認の契約を確認しているわけではない。操作後の完了・拒否・取消しは `showState()` でテスト側から与えており、本番の承認結果ではない。

統合先: 同ファイル内で、応答の種別・要求との対応・応答待ちの保持を確認する操作群と、ツールごとの説明・狭幅・明暗・詳細展開を確認する表示群に分ける。同じ応答契約の反復を減らし、各ツールに固有の表示条件は引き継ぐ。R07 のテーマ修正も必要。

Host の許可・拒否、SDK の配線、OS 境界は別の責任なので統合しない。UI に与えた「操作は実行されていません」という本文を、実際の副作用がなかった証拠として扱わない。

## 削除対象

### D01: SVG の内部クラス名だけを固定するアサーション

対象: [run-status.spec.ts](../../tests/e2e/ui-review/run-status.spec.ts) の17–27行にある `svg.${icon}` の確認、[loaders.spec.ts](../../tests/e2e/ui-review/loaders.spec.ts) の25行・71–72行の具体的な `cat-*` クラスの確認。

**静的確認。** 同じ図柄・動き・状態表示のまま SVG のクラスだけを改名しても失敗する。ポリシーの「外部挙動を変えないリファクタだけで壊れるアサーション」に該当する。

削除単位はクラス名の一致を求める検査。状態のメッセージ、アイコン領域の表示、停止操作、動きを減らす設定、アニメーション・図柄の視覚確認は担当を残す。具体的なクラス名を画面仕様と混同しない。テスト全体の削除ではない。

### D02: 成功時の書込み回数を固定するアサーション

対象: [pi-update.test.cjs](../../tests/pi-update.test.cjs) の215行と280行の `writes.length === 3`。

**静的確認。** 生成内容が同じでも書込み方法を変えると壊れ、逆に3回書けば内容が不正でもこの検査は成功する。必要な出力の名前と内容を確認する契約へ担当を移したうえで、回数の固定を削除する。既存のライセンス本文・完全固定された依存指定の検査は維持する。

264行の失敗時の書込み0回は、不正入力で既存ファイルを変更しない安全性を確認しているため削除対象外。承認や通信の二重実行を検出する回数の検査にも、この削除判断を適用しない。

## 実行結果と限界

| 今回の検証 | 結果 | 判断できること |
| --- | --- | --- |
| `referenceClipboard`、`jevGuard`、`openAIModelCatalog`、`piMcpConfig` の通常実行 | 4ファイル・35件成功 | 現状の期待値では成功する |
| 同4ファイルでサイズ制限4か所を無効化 | 35件成功、4か所すべての変換適用を確認 | R02–R05 の検出漏れ |
| `textlint-audit.test.mjs` の通常実行 | 4件成功 | 現状の期待値では成功する |
| レビューの保存項目を落として同ファイルを実行 | 4件成功 | R06 の検出漏れ |
| `piToolFeatures`、`piToolFeatureSession`、`piHttpMcp`、`piResultDisplay`、`piHistoryMapper` | 5ファイル・35件成功 | 既存の検査範囲での成功。R10・R11・M01 の未保護経路を保証しない |
| `codexTransport`、`codexHistory`、`attachmentDrop`、`workflowEditor`、`workflowPanel`、`piWorkflowDefinition`、`guardrails`、`workspaceTrust`、`piStorage`、`personality` | 10ファイル・101件成功 | フェーズ17以外の関連範囲の通常実行 |
| 通常ツールの30万文字の結果を本番の保護処理に渡す | 無効時2条件は返却、有効時4条件は構文エラー。元の実行は各1回 | R10 の局所的な再現 |
| 受入4本のビルド部分のみを同じ起点で実行 | 4本とも解決失敗 | R01。外部環境の状態に依存しない入口の不備 |

通常実行は Vitest の `config/vitest.host.config.ts` または Node の標準テストランナーを使用した。サイズ制限の検証は同じ Vitest 設定に読込み時の変換を加えたもの。診断用ファイルは `dist/testing-policy-audit-2026-10-01/` に置いた。これらの一時検証は監査の証拠であり、継続して回帰を防ぐ担当テストとしては数えない。

再監査では Host 側の全721ケースを実行した。さらに補完・計画通知・完了待ちの3か所を壊しても、721ケースすべてが成功した。詳細は[追加の実行結果](Testing-Necessity-Review-2026-10-01.md)を参照する。

実認証、外部サービス、VS Code の実画面、OS サンドボックスの受入本体は実行していない。R08・R09 の反例も実機での再現済みとはしない。既存のレポートにある全件成功数を、今回の成功数へ加算しない。

## 整理の進め方

1. R01 の実行入口を直し、受入試験が本体へ到達できるようにする。必要な外部環境は各コマンドの前提として明記する。
2. R02–R06 と R10–R11 は、見逃す不具合を既存の担当へ取り込み、その不具合がある状態では失敗することを確認する。製品の修正後に同じ担当テストを再実行する。
3. R07–R09 は要求した条件と実際の画面・終了状態を一致させる。写真や成功件数だけで完了にしない。
4. M01–M02 は担当する固有の失敗経路を移してから重複を整理する。D01–D02 は内部構造だけを固定する検査を削る。

繰返し実行する入口は、ロジック・結合が `test:host`、文書検査が `test:tooling`、表示と操作が `ui-review` となる。実 Extension Host は `test`、OS・外部パッケージは各受入コマンドを使う。入口は存在するため、「一度しか実行されていない」と履歴を推測して断定はしない。R01 のような入口の故障と、成功しても不具合を検出できない検査を具体的に取り除く。

保存先の契約と独立した復元、承認の許可と拒否、実 SDK と OS の境界には別々の検証責任がある。これらを、似たテスト名や固定データという理由だけで削らない。一方、固有の回帰を説明できない検査は、残すこと自体を成果にせず削除・統合する。

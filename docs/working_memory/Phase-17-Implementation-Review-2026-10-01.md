# Phase 17 実装レビューレポート

レビュー日: 2026-10-01。

## 判定

**修正が必要。** 基本経路の実装と既存テストは成立しているが、結果の保護・実行結果が不明な場合の扱い・表示情報の受渡しに3件の不具合を確認した。加えて、一部のライトテーマ試験が実際にはダークテーマで実行される検証上の問題を確認した。

| ID | 優先度 | 指摘 |
| --- | --- | --- |
| R1 | P2・中 | 検索またはコード実行を有効にすると、大きな通常ツール結果が JSON の構文エラーになる |
| R2 | P2・中 | 送信済み MCP 操作の結果が不明な場合を、通常の失敗と区別できない |
| R3 | P3・低 | MCP の構造化結果の表示元・省略情報が UI への変換で失われる |
| R4 | P2・中 | 利用枠と通常ツールカードのライトテーマ試験がダークテーマで実行される |

P2 は機能・安全な操作判断・受入検証に影響する修正対象、P3 は表示上の修正対象とする。承認の迂回や秘密値の流出が再現したという指摘ではない。

## 対象と方法

- 指定された Phase 17 の仕様ページの本文、到達点、完了チェックを照合した。
- 基準コミットは `ab70a5e96d42bf913b97028551027c3717a3aa27`。レビュー対象は、このコミット上の未コミット変更・未追跡ファイルを含む作業ツリーとした。
- [実装境界の記録](Phase-17-Implementation-Boundaries.md) も参照した。MCP 管理画面の別フェーズ化と、stdio MCP の上流対応への移管は合意済みの範囲として扱い、未実装の不具合には数えない。
- 依存グラフは同じコミットを参照していた。未コミット変更があるため、グラフは調査箇所の選定に使用し、判断は実ファイルと実行結果に基づけた。
- OpenAI の認証・モデル・利用枠、MCP の設定・接続・動的登録・承認、検索とコード実行、結果変換・履歴・共有契約・UI、配布処理と関連テストを調査した。

## R1: 大きな通常ツール結果が秘密値除去の途中で破損する

主な箇所: [PiFeatureSafety.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureSafety.ts) の20–26行。
利用側: [PiFeatureToolResults.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiFeatureToolResults.ts) の11–30行、[PiRuntime.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime.ts) の372–374行。

`privateFeatureValue()` は結果全体を JSON に変換し、UTF-8 で262,144バイトに切り詰めた文字列を、そのまま `JSON.parse()` へ渡している。上限が文字列値の途中に来ると閉じ引用符と括弧を失い、結果の省略ではなく構文エラーになる。

`protectPiFeatureTool()` は `codemode` または `toolSearch` が有効な場合、通常の Host ツールにも適用される。このためコード内からの呼出しに限らず、画像を読む通常の `read` や、大きな結果を返す許可済み拡張も影響を受ける。副作用が完了した後の結果変換で失敗する場合は、操作自体の失敗とも区別できなくなる。

再現では、30万文字の画像データを持つ結果を返すツールに本番の保護処理を適用した。`toolSearch: true` で実行すると、次の例外で失敗した。SDK の結果形式を入力し、結果保護処理を検証した。画像デコーダー自体はこの再現の対象に含めていない。

```text
SyntaxError: Unterminated string in JSON at position 262144
```

修正方針: JSON の構文を切らず、値を走査する段階で秘密値と上限を処理する。通常の画像結果をモデルへ渡す経路と、コード実行・UI 向けの有限な要約を区別する。上限超過を省略結果または明確な上限エラーとして扱い、元の操作の成功状態を失わせない。

回帰確認: 上限前後のテキスト、多バイト文字、画像を、通常呼出しとコード内呼出しの両方で確認する。

## R2: MCP の実行結果が不明な場合を通常の失敗として保存・表示する

主な箇所: [PiMcpServer.ts](../../apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpServer.ts) の292–295行。
利用側: [PiToolMapper.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiToolMapper.ts) の227–234行、[共有状態](../../packages/shared/src/chatState.ts) の57–63行。

MCP の要求送信後に応答を失った場合も、認証・接続などの失敗と同じ例外へ変換される。共有状態への変換では `isError` を通常の `failed`、停止中なら `cancelled` とする。送信済みで実行結果を確定できないことを表す情報は保存されない。

SDK 本体とローカル HTTP サーバーで、`tools/call` をサーバーが受け取った後に404を返す条件を再現した。サーバーへの到達は1回であり、自動再送の抑止は機能した。しかし、保存される結果は次の情報だけだった。

```json
{
  "content": [{
    "type": "text",
    "text": "MCP 操作を完了できませんでした。接続・認証・取消し状態を確認してください。"
  }],
  "details": {},
  "isError": true
}
```

サーバー側の副作用を取り消せた証拠はなく、ユーザーやモデルが再試行を判断するための情報が不足する。仕様の「実行結果が不明な操作を成功・失敗と区別する」を満たしていない。実際の二重実行までは再現していない。

修正方針: 送信前の拒否、サーバーが返した明確な失敗、送信後に結果が不明になった状態を区別し、共有契約・UI・履歴へ保持する。本文にも、操作が実行された可能性と再試行前の確認が必要なことを伝える。

回帰確認: 送信後の404・切断・Stop について、再送しないことに加え、実行結果が不明な表示と履歴復元を確認する。

## R3: 保存前に付けた構造化結果の表示情報を読み捨てる

主な箇所: [PiResultDisplay.ts](../../apps/vscode-nerita/src/extension/backends/pi/results/PiResultDisplay.ts) の21–23行。
生成側: [PiMcpTools.ts](../../apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpTools.ts) の88–99行。
利用側: [PiToolMapper.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiToolMapper.ts) の97行、[PiHistoryMapper.ts](../../apps/vscode-nerita/src/extension/backends/pi/PiHistoryMapper.ts) の70–85行。

`safeMcpResult()` は構造化結果を安全な本文へ変換し、`details.resultDisplay` に表示元と省略情報を付ける。しかし、その結果を受け取る `piResultDisplay()` は本文があると即座に返り、この情報を参照しない。実行中の通知と履歴復元が同じ変換を通るため、両方で失われる。

再現入力は `content: []` と `structuredContent: { count: 3 }`。`safeMcpResult()` の後に実際のイベント変換と同じ `piResultDisplay()` を通すと、`resultDisplay` は `undefined` になった。

本文の要約自体は残り、省略の説明も本文に入っていれば表示される。失われるのは表示元・省略の構造化された情報であり、UI の「構造化結果」ラベルを本番の MCP 経路で表示できない。Storybook の固定状態を表示する試験だけでは検出できない。

修正方針: Host が生成した表示情報を検証して引き継ぐ。任意の外部ツールが `details` を自己申告しただけで MCP 由来と認定しない設計は維持する。

回帰確認: 実際の MCP の結果を、保存前変換、イベント変換、共有状態、履歴復元まで通して表示元と省略情報を確認する。

## R4: 一部のライトテーマ試験が実際にはダークテーマになる

主な箇所: [quota-bar.spec.ts](https://github.com/YayanmaBanban/VSCode-Codex-Nerita/blob/ab70a5e96d42bf913b97028551027c3717a3aa27/tests/e2e/ui-review/quota-bar.spec.ts) の14–19行、[tool-cards.spec.ts](https://github.com/YayanmaBanban/VSCode-Codex-Nerita/blob/ab70a5e96d42bf913b97028551027c3717a3aa27/tests/e2e/ui-review/tool-cards.spec.ts) の112–115行。
根拠: [Storybook の設定](../../apps/nerita-ui/.storybook/preview.tsx) の9行と35–48行。

削除済みのテストファイルへのリンクは、レビュー時点の基準コミットを参照する。

両試験は `page.emulateMedia({ colorScheme: theme })` だけで明暗を切り替えている。一方、Storybook は初期のテーマを `dark2026` に固定し、DOM の属性へ反映する。対象の URL ではテーマを上書きしていないため、ライトの試験でもダークのスタイルが適用される。

今回生成した次の画像を開き、ライトの名前で保存された画像もダーク表示であることを確認した。

- `dist/ui-review/test-results/quota-bar-利用枠のバー-light-chromium/quota-status.png`
- `dist/ui-review/test-results/tool-cards-ツールカードの開閉と表示-light-chromium/running.png`

この結果から製品のライトテーマの不具合は判断できず、明暗の受入確認が不足している。プロバイダー設定と構造化結果の専用試験は `globals=theme:light` を指定しており、生成画像でもライト表示を確認できた。

修正方針: 対象の URL に明示的なテーマを渡し、撮影前に実際のテーマ属性も確認する。テスト名と `colorScheme` の設定だけで明暗を確認済みと扱わない。

## 仕様との対応

| 範囲 | 確認した実装 | 判定・留保 |
| --- | --- | --- |
| 17-1 認証・モデル | `openai` への移行、安定した端末識別子、SDK の認証方式、通常推論と Ultra の分離、優先処理の要求 | 調査・自動検証の範囲で新たな不具合は特定していない。実サービスでのログイン・更新は今回再実施していない |
| 17-1 利用枠 | 新 OAuth の取得が401・403なら既存 Codex ログインの読取りへ委譲し、取得元を表示 | プロバイダー設定の明暗画像で取得元を確認。2つの認証のアカウント一致を保証する実装とは扱わない |
| 17-2 HTTP MCP | 設定の優先順位、承認後の改訂確認、通信許可、動的登録、リソース、停止と再送抑止 | 既存の SDK 本体を使う結合検証は成功。R2 の状態区別が不足 |
| 17-3 検索・コード実行 | 明示的な組み込み拡張、許可集合、実際の引数での個別承認、有限の実行・出力・保存上限 | 既存検証は成功。R1 は通常ツールにも影響する |
| 17-4 結果・履歴 | 本文優先、有限の要約、秘密値の除去、プレーンテキスト表示、入れ子の履歴 | 要約本文は生成される。R3 の表示情報が欠落 |
| 17-5 UI | 320px 幅で設定・利用枠・ツールカードの操作を検証し、生成画像を確認 | 11件成功。ただし R4 の2種類はライト表示の確認に数えない |

## 実行した検証

| 検証 | 結果 |
| --- | --- |
| `pnpm check` | 成功。Lint と製品・UI・テストの型チェック |
| `pnpm test:host` | 102ファイル、721件成功 |
| `pnpm test:runtime` | 23件成功。移動した配布資産、OAuth、ローカル検索、MCP、QuickJS を含む |
| `pnpm ui-review pi-provider-controls quota-bar tool-cards` | 11件成功。対象の生成画像10枚を開いて確認。R4 の検証不足を発見 |
| 追加の一時的な再現検証 | 5件中3件が期待する振る舞いを満たさず、R1–R3 を再現。再接続後の名前維持と、引用符を含む既知の秘密値の処理は成功 |
| `pnpm pi:verify` | 成功。VSIX を新規ビルド・展開し、開発用と展開後の両方で会話・検索・QuickJS・MCP・承認・拒否・Stop・保存前変換を検証 |

追加の検証は、SDK 本体とローカル HTTP サーバーを使う既存の準備処理を使用した。一時テストは確認後に取り除き、既存テストの期待値や製品コードは変更していない。

UI の生成結果は `dist/ui-review/` にある。実行前の結果は `dist/ui-review-history/phase17-review-20261001-before/` に保存した。今回の画像確認では、プロバイダー設定・利用枠の取得元・構造化結果は明暗双方で読み取れた。アニメーションの中間状態は今回評価していない。

## 未確認事項と対応順

実サービスの新規 ChatGPT OAuth、実トークン更新、認証付き外部 MCP、Windows の実際の Extension Host での操作は今回再実施していない。仕様ページにある過去の受入結果と、今回実行したローカル検証は区別する。

1. R1 の結果保護処理と、R2 の実行結果が不明な場合の扱いを修正する。
2. R3 の表示情報を本番の変換・履歴へ接続する。
3. R4 のテーマ指定を直し、対象2種類のライト画像を再確認する。
4. 各指摘の再現条件を既存の担当テストへ追加し、修正した経路を再検証する。

MCP 管理画面と stdio MCP は、既存の追跡内容を維持する。新 OAuth 自体での利用枠取得、実サービスでの優先処理の適用、実トークン更新の留保も引き継ぐ。今回のテスト成功によってこれらの留保が解消したとは判断しない。

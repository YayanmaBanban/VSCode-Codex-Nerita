# Agent Manager とハンドオフ設定

## 操作と保存先

コマンドパレットの `Nerita: Agent Manager を開く` から開く。
複数ルートの場合はワークスペースを選択する。同じルートのパネルは再利用する。
閲覧だけでは設定ファイルを作らない。

| 対象        | 編集内容                                                                   | 保存先                                            |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Pi Agent    | disabled / model / thinking の Workspace override                          | `.pi/settings.json` の `subagents.agentOverrides` |
| Pi 既定値   | defaultModel / defaultThinking / maxThinking / maxSubagentSpawnsPerSession | `.pi/settings.json` の `subagents`                |
| Codex Agent | model / model_reasoning_effort                                             | `.codex/agents/*.toml`                            |
| ハンドオフ  | timeoutMs / backend ごとの strategy・model・推論指定                       | `.nerita/handoff.json`                            |

Pi の定義は既存ローダーで package / user / project から取得する。
定義値と Workspace override を分けて表示し、ユーザー設定と modelScope は閲覧のみとする。
管理画面は設定優先順位を計算しない。接続中のバックエンドの候補を使い、未接続側は管理画面専用のカタログ読込みで取得する。
Pi では親と異なるプロバイダーのモデルも候補に含める。

Codex は標準配置の直下 TOML を対象とする。名前はファイル名ではなく `name` から取得する。
コメント・複数行プロンプト・無関係なテーブルを保持し、モデル設定だけを変更する。
標準仕様で確認できない個別の有効／無効は編集項目に含めない。
同名定義や未対応の推論指定は、内容を削除せず編集不可として表示する。

## ハンドオフ

今回は設定の管理・保存を対象とする。引継ぎ文の生成、モデル実行、セッション移行は開始しない。

- `fixed` は `model` を必須とする。
- `current` は実行開始時のセッションモデルを使う指定。固定の `model` を保存しない。
- Pi は `thinking`、Codex は `reasoningEffort` を保存する。
- `timeoutMs` の初期値は120000。正の整数に限定する。
- ファイルがない場合は両 backend とも `current` を表示する。
- スキーマは拡張機能に同梱し、VS Code の `jsonValidation` で関連付ける。
- Workspace には `handoff.json` だけを保存し、`$schema` は付けない。旧形式の相対参照は次回保存時に除去する。既存のスキーマファイルは削除しない。
- 壊れた JSON を検出した場合、初期値から作り直す操作を選ぶまで保存を無効にする。

ハンドオフのモデル欄は全候補を表示する選択欄で、選択済みの名前による自動絞込みは行わない。
未接続 backend の保存済みモデルも保持できる。モデル実行による利用可能性の確認は行わない。

## 保存と競合

Host はパネルのワークスペースと内容の世代を照合する。
別パネル・外部エディタから保存されていた場合は上書きせず、再読み込みを求める。
未保存の設定文書、除外されたワークスペース、未信頼のワークスペースへの保存を拒否する。
設定ディレクトリやファイルがリンクで別の場所を指す場合も拒否する。
保存はルートごとに直列化し、一時ファイルから置き換える。

Pi 設定は `jsonc-parser` で対象プロパティだけを変更する。
SDK の公開 SettingsManager には `subagents` を更新する汎用メソッドがないため、
非公開メソッドの呼出しや JSON 全体の再生成は行わない。
配布時にはライブラリの ESM 入口を使用し、UMD 内の相対 require を残さない。

## 実行側との境界

モデルを明示した Agent 設定・Pi defaultThinking・fixed ハンドオフでは、モデル別の推論候補を表示し、Host でも保存時に組合せを検証する。
Pi は同梱 SDK の `getSupportedThinkingLevels(model)`、Codex は App Server の `supportedReasoningEfforts` を使う。
Pi にプロバイダーの補助カタログがある場合は、各モデルの provider と ID に対応する項目の推論値を優先する。SDK 標準候補との積集合で Ultra などを除外しない。親の選択モデルの候補を他モデルへ流用しない。
Pi の管理・保存スキーマは Ultra を受理する。SDK の実行時の推論変換や override はこの管理機能の対象外。
Codex の専用接続はモデル一覧の取得後に終了し、会話を作らない。取得失敗はバックエンド別に表示する。
非対応の値は選び直すまで保存できない。未接続の既存値は保持できるが、新しい推論指定には対応値の確認が必要。
モデル未指定時の優先順位は解決しない。Pi の `maxThinking` はモデル横断の上限なので共通の列挙値を使う。
ハンドオフの `current` は実行時までモデルが確定せず、明示した推論は実行時の検証が必要。
`current` の入力候補には現在接続中のモデルの対応値を表示する。接続中のモデルが不明なら新しい推論候補を推測しない。

この変更は設定管理と保存の層を追加する。
PiSubagentTool の実行時の設定解決、Registry による即時反映、
起動上限の強制は変更していない。
現行 Host アダプターは接続時の定義を保持しており、
管理画面の保存成功を新規子への適用完了として扱わない。
実行中数と履歴数は、読み込んだ時点の現在セッションの値を表示する。
累積起動上限の消費数とは区別する。

## 検証

- 管理・保存と Host 境界の単体18件、BackendRuntime の既存5件。
- 実 Extension Host 11件。同梱 SDK による定義読込と設定保存、既存起動処理を確認。
- UI レビュー6件。320px / 1100px、明暗テーマ、Pi・Codex・ハンドオフの保存、
  キーボード操作、競合時の入力保持、不正 JSON の修復、空一覧を確認。
- 画像は `dist/ui-review/test-results/`、レポートは `dist/ui-review/report/`。
- 既存の UI 成果物は `dist/ui-review-history/agent-manager-20260926-1938/before/` へ退避。

実行中 Agent への設定適用と、実モデルへのハンドオフはこの検証の対象外。

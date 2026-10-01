# Phase 17 の未確認・未実装の境界

2026-09-30、Pi 0.99.1 と同梱 Codex 0.159.1 を使用して確認した。
フェーズ全体の完了記録ではなく、次の実装で引き継ぐ制約を残す。

## 新しい ChatGPT OAuth

Pi の `openai-codex` を配布対象から削除し、`openai` の新しい OAuth と API Key へ統一した。
旧 credential のコピーや、保存済み旧モデル ID の読み替えは行わない。
インストールごとに安定した device ID を新しいログインへ渡す。

ユーザーが新しい OAuth を設定し、モデルを利用できたことを確認した。
同じ保存済みの新しい credential で `GET https://api.openai.com/v1/models` は200を返した。
`gpt-6-astra` と `gpt-5.6-sol` の短い実要求も `response.completed` まで完了した。
更新用トークンの実更新は未確認。認証値と応答本文は診断ログへ保存していない。

同じ新しい credential で `GET https://chatgpt.com/backend-api/wham/usage` は401を返した。
エラーは `type: rejected_by_access_enforcement`、`code: no_matching_rule`。
この token には `chatgpt_account_id` がなく、アカウントのヘッダーを推測していない。
会話応答のヘッダーと使用量には、5h・週次の残率やリセット時刻を確認できなかった。
`OpenAIQuotaService` は取得失敗を `null` へ変換し、旧 credential へ戻さない。
公式の新 OAuth ガイドは ChatGPT の設定内の Usage を案内している。
公開されている組織の Usage API は管理者キーによる API 使用量の集計であり、ChatGPT の利用枠へ流用しない。
新 OAuth で利用できる正式な代替取得 API は確認できていない。
新 OAuth 自体の代替 API は未確認だが、以下の Codex ログイン経路で利用枠の取得と表示を確認した。
Codex CLI の現在の取得実装も ChatGPT の接続先では `wham/usage` を使用する。
通常ターミナルの Codex 0.159.0 と同梱 Codex 0.159.1 で、読取り専用の `account/read` と `account/rateLimits/read` が成功した。
既存 CLI ログインでは週次の残率とリセット時刻を取得できた。同じ環境の新 Pi OAuth トークンによる401とは認証経路が異なる。
診断では Host の変換後の応答型を使用する。アカウントは `authenticated`、利用枠はウィンドウ配列であり、生 RPC の `account`・`rateLimits` を再参照しない。
利用枠を取得する追加依頼に合わせ、401・403の場合に既存 Codex ログインの利用枠を取得する補助経路を実装した。
同梱 CLI の読取り RPC を使い、認証値を Pi へコピーしない。取得元は `source: codex-login` として共有契約へ渡す。
表示は見出し、区切り線、時間枠と残率、リセット時刻、区切り線、`Codexのログイン情報から取得中` の順とする。
未ログイン・失敗・取消では表示せず、取得用の接続は毎回回収する。本番サービスを使った実測でも週次の残率とリセット時刻を取得した。
この補助表示は、新 OAuth 自体での取得成功やアカウントの一致を意味しない。

GPT-6.1-Sol がモデル一覧にない原因は、移行時に `client_version=0.999.0` の指定を落としたことだった。
旧 Codex と新 OAuth の取得先へ同じ版指定を付けて比較すると、モデル一覧・公開状態・推論レベル・Ultra 用の値・Fast の対応情報が一致した。
新 OAuth のモデル取得へ版指定を戻し、取得済みライブ一覧と SDK の両方にある公開モデルだけを選択候補にする。
これにより GPT-6.1-Sol を維持し、GPT-4・Daybreak 系などライブ一覧にないモデルを除外する。
初回の取得に失敗した場合は SDK 候補を維持し、同じ認証で取得成功後の通信失敗には成功キャッシュを使う。

通常の推論は SDK の `thinkingLevelMap` と利用可能レベルへ従う。
Ultra はライブカタログが明示するモデルだけに公開する。
実推論値は `multi_agent_reasoning_effort`、対応する `max`、最後の通常候補の順で解決し、SDK の対応レベルへ写す。
利用できる子定義と子起動ツールがある場合の Host 委譲設定として扱う。
`multi_agent` を API payload へ追加しない。

公開モデル一覧には `service_tiers: [{ id: "priority", ... }]` と `additional_speed_tiers: ["fast"]` がある。
ただし、新 OAuth で `gpt-6-astra` へ `service_tier: "fast"` を送ると400と `Unsupported service_tier: fast` が返った。
`service_tier: "priority"` は2モデルで送信を確認した。
対象は `gpt-6-astra` と `gpt-5.6-sol` で、両方が200を返して完了した。
両方の応答の `service_tier` は `default` だった。
Fast mode はライブカタログの `service_tiers` に `priority` があるモデルへ公開する。
Codex CLI と同じ `service_tier: "priority"` を送る設定として実装した。
応答の実処理区分が `default` だったことを理由に、要求する設定まで非公開にはしない。
モデル・認証・能力の変更で解除し、別モデルや圧縮用要求へ流用しない。
実 SDK の送信内容と解除、UI の表示とキーボード操作を検証した。実サービスでの高速処理は未確認。
根拠は OpenAI の[新 OAuth ガイド](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、
[Fast mode ガイド](https://developers.openai.com/api/docs/guides/fast-mode)、上記の実測結果。

## Windows Sandbox と stdio MCP

`tests/sandbox-duplex-preflight.mjs` で実 App Server の設定と準備状態を確認した。
Sandbox 内の通常の `command/exec` は成功した。
`streamStdin` と `streamStdoutStderr` を付けた要求は RPC エラー `-32600` で拒否された。
エラーメッセージは次のとおり。

```text
streaming command/exec is not supported with windows sandbox
```

したがって、既存 `command/exec` のストリーミング機能で stdio MCP を接続できない。
試作した双方向実行アダプターは製品へ残さず、再検証用のスクリプトを残した。
このスクリプトは未対応を検出すると終了コード1を返し、通常の検証成功へ含めない。
生の子プロセス起動へ切り替える経路は追加していない。
stdio MCP は Docker が必要な上流対応として既存の追跡タスクへ移管した。ユーザーの判断により、Phase 17 では移管をもって完了とする。

## MCP・コード実行の有効化条件

MCP の設定読込みはワークスペース、グローバル、信頼した拡張の順で上位を優先する。
不正な上位設定から下位へ戻さず、設定改訂・サイズ・リンク先・コマンド補間を検査する。
HTTP MCP の接続・動的登録・再接続を Host へ接続した。管理画面は別フェーズで扱う。
設定ファイルの `enabled: true` が必要で、接続は最初の会話実行で承認する。
通信禁止や子の許可集合に対象サーバーのツールがない場合は接続しない。
設定・環境変数・信頼状態・ツール定義の変更で、古い接続と承認を失効させる。

配布用の MCP アダプターは、SDK の設定検証・接続・動的定義・構造化結果を扱える。
実 SDK の HTTP 接続・Bearer 認証・保存済み OAuth の更新をローカル検証サーバーで確認した。
既存の新 OpenAI OAuth と GPT-6.1-Sol を使い、Bearer 認証を設定した実 CRG HTTP サーバーで検索とコード内の子呼出しを確認した。
認証なしの CRG HTTP 要求は401となった。認証値は検証用で、ツールの出力やログへ保存していない。
対話的な MCP ログインと管理操作は別フェーズに残す。
副作用の有無が分からない MCP 呼び出しを、セッション期限切れだけで再送しないよう配布変換を追加した。

SDK の MCP 結果変換は、空の本文へ JSON を補い、巨大な結果を一時ファイルへ保存する。
`extensions/mcp/tools.js` の既定変換を使わず、秘密値と保存上限を適用した Host 変換を組み込んだ。
ツールとリソースの各操作を個別に承認し、保存前に安全な本文へ変換する。
SDK の `MessageToolResult` は構造化フィールドを保存しないため、保存前に安全な本文へ変換する。
履歴の `details` から MCP の出所や構造化結果を推測しない。

QuickJS の WASM・ワーカー・実行・Stop は配布アダプターで確認した。
ローカル BM25 は新しい OAuth 形式の検証用 credential で送信 payload を捕捉した。
通常の function ツールと `additional_tools` を使うことを確認した。
ネイティブ `Tool Search` と `defer_loading` は送信しない。
この先行検証に加え、本番 Host の承認・拒否・Stop と実サービス接続を確認した。

`codemode` と `tool_search` は、名前付きの組み込み拡張として Host へ注入する。
ユーザー設定の `nerita.pi.codemode` と `nerita.pi.toolSearch` で選択し、既定は無効とする。
MCP 未接続でも Host ツールを対象にできる。MCP 管理ビューは別フェーズで扱う。
SDK の登録許可集合と初期表示集合を分離し、検索で追加する定義も Host の許可集合に限定する。
外部拡張の動的登録にも同じ許可・承認・出所確認を適用し、組み込み名の上書きを拒否する。
子の `allowedTools` と親から継承する権限を広げない。

コード実行のモデル呼出しは無効にし、承認待ちを含めて60秒で停止する。
コード内の指定で期限や出力上限を延ばせない。QuickJS のメモリー上限は256 MiB。
入力は UTF-8 で64 KiB、子と探索用の呼出しは合計32回、同時に4回までとする。
各呼出しの引数は65,536文字、結果は262,144文字までとする。
出力は32,768文字・128項目・8,192推定トークンまでとし、超過時に全出力を一時保存しない。
`store` は JSON の合計65,536文字、値16,384文字、キー128個、キー名256文字までとする。
1回の書込みも128キーと65,536文字以内に限定し、履歴からの復元にも上限を適用する。
検索文字列は2,048文字、読み込む定義は16件までとする。
既知の認証値と認証フィールドを、子の結果・更新イベント・親の結果・`store` の保存前に除去する。

同梱の実 SDK で承認拒否・期限切れ・Stop・呼出し上限・出力と保存の超過を検証した。
実会話ループで Host ツールの検索、実引数による個別承認、`parentToolCallId` と要約の保存・復元を確認した。
HTTP MCP の製品接続は、実 Extension Host、開発用と展開した VSIX、上記の認証付き CRG で確認した。
MCP の管理操作の受入は含めない。

## 構造化結果の表示

有用な本文と画像説明を優先し、空欄だけ構造化結果から補う。
秘密キー・既知の秘密値・バイナリーを除去し、32 KiB の全体予算、4 KiB の文字列上限、
深さ6、コンテナー50項目、合計200ノードを走査中に適用する。
表示専用の本文と由来・省略情報だけを共有契約へ渡す。
MCP の包まれた結果は、Host 登録が確認した出所情報を渡す場合だけ展開する。
保存した要約を再読込みし、元のツールやコードを再実行しないことを確認した。

## テストの責任と更新時の注意

Workflow は pi-subagents の固定バージョン判定を撤去し、導入済みの0.73.1で実行した。
パッケージ名・実体パスの境界・必要な実行 API を検証し、バージョンだけで拒否しない。
生成コードの引用形式を固定せず、実行して依存先の出力・継続 ID・本文のコード混入防止を検証する。
単体テストは生成コードの振る舞い、実パッケージと Extension Host は SDK・Worker・子の権限の接続を担当する。

配布テストのバージョン一致、公開関数の存在だけの検査、遅延チャンクの内部ファイル名・分割方法の固定を削除した。
移動した配布先で拡張ツールを読み込み、実行結果を確認する。
Shell の説明文・サンプル文言・文字コード設定用のスクリプト断片を重複して固定しない。
承認前の未実行、拒否・Stop、実行ファイルと引数、秘密値の除去を Host で検証する。
日本語の入出力とパイプの動作は `tests/pi-shell-smoke.mjs` の実プロセス試験が担当する。

`tests/sandbox-read-boundary-smoke.mjs` の旧 CLI バージョン固定も撤去した。
現在の elevated Windows Sandbox は有効な `:root` の読取り権限を必要とし、ルート禁止の設定では起動を拒否する。
同じ初期化失敗を各ファイル操作の失敗として重ねず、CLI と App Server ごとに未対応設定の拒否と未実行を確認する。
対応設定では外部読取りが可能で、外部書込みを拒否する。これは外部読取り隔離の成立を意味しない。
Host のパス・承認・信頼の境界を検証する担当テストは維持する。

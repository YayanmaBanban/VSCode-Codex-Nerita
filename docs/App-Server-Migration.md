# Codex App Server への移行

Phase 4まで実装済み。現在の接続方式は同梱Codex App Serverのみで、旧ACPの実装・依存・実行資産は削除した。

## Phase 1: チャット接続の切り替え

Extension Host は src/extension/codex/CodexSessionController.ts を使用し、同梱 Codex 0.154.0 の App Server に接続する。生成型は src/codex-app-server/、起動・通信・状態管理は src/extension/codex/ に配置する。

対応済みの処理:

- initialize → initialized → 認証確認 → thread/start。
- turn/start、agentMessageの逐次表示・確定本文の反映。
- Stopを開始応答と対応するturn/startedまで保持し、turn/interruptを一度だけ送信。turn/completedで停止を確定し、同じthreadで続行する。
- コマンド実行・ファイル変更のserver requestを承認UIに接続し、元のrequest IDにaccept / decline / cancelを返す。
- 古い接続・thread・turnの通知を排除し、切断・停止・サーバー側の承認解決時に待機を解消する。
- 新規会話と、Webview再表示時の現在の会話の復元。

UIの実行IDとサーバーのturn IDは分ける。開始応答を完了と扱わず、応答より早い通知も保留して照合する。停止を10秒間確認できない場合は接続を終了し、再接続を案内する。

## Phase 2: ツール・設定・認証・添付

Phase 1の接続を維持し、以下を接続した。

- コマンド出力のdelta・端末入力通知・終了結果。停止はターン全体へのinterruptを使う。
- 推論のsummary/contentパート、計画、MCP・動的ツールの実行結果、エージェント作業、検索などのカード。
- fileChangeの更新とturn全体のunified diff。本文の前後を推測せず、サーバーが返した差分を直接表示する。
- model/listのページング、モデル・推論量・sandbox・service tier。Fast modeはカタログがpriorityを提供するモデルで有効にする。設定は次のturnに適用し、config.tomlを書き換えない。
- account/rateLimits/read・updatedの利用枠と、thread/tokenUsage/updatedのコンテキスト使用量。APIキーや独自プロバイダーなどで利用枠を取得できない場合は未取得として扱う。
- ChatGPTのブラウザログイン、環境変数CODEX_API_KEY / OPENAI_API_KEYからのログイン。ログインを中止して再接続できる。認証情報はWebviewへ渡さない。
- 選択済みUTF-8テキストの添付（合計2MB、最大20ファイル）と、画像対応モデルへのlocalImage。送信受付成功後に添付欄を空にする。失敗時は添付を保持する。
- 追加権限の承認（このターンのみ）、ユーザー質問、MCP URL・基本フォーム入力。質問はVS Codeの標準入力UIで扱い、秘密入力をチャット状態に残さない。停止・切断・サーバー側取消に追従する。

### 対応範囲の制限

experimentalApiは引き続きfalse。Collaboration modeの変更、クライアント定義の動的ツールの実行、外部トークン更新、attestationは提供しない。
MCPフォームは文字列・数値・整数・真偽値・単純なenumと必須・範囲・文字数を扱う。複合schema、format付き項目、配列などは承諾せずdeclineを返す。未知の追加権限表現にもRPCエラーを返す。
画像以外のバイナリ、PDFの抽出、音声添付は未対応。モデル側でツールが起動したバックグラウンドプロセスの個別管理は、foreground turnの停止とは別の対応が必要。

### Phase 2の確認結果

- 型検査・Lint、単体79件、ツール設定の型検査を実行。
- UIはchat・app-server・tool-cardsの18件が成功。画像確認でファイル名の重複を修正し、影響する9件を再検証。
- 実モデルで返信・停止・同じthreadで続行を確認。
- 実モデルでモデルカタログと設定・テキスト添付・ファイル編集・unified diff・コマンドの逐次出力・使用量を確認。
- OAuthの新規ログイン・APIキーログイン・入力ダイアログは単体テストで通知順序・中断・回答を検証。既存のユーザー認証を変更しての再ログインは実施していない。

実機機能テストはpnpm test:codex:featuresで実行する。モデル使用量が発生し、dist/codex phase2 smoke/内の隔離フォルダーにテスト用ファイルを作成する。画像とUIレポートはdist/ui-review/に保存する。

## Phase 3: 履歴と会話の管理

- thread/listをcwd・アーカイブ状態で絞り、更新日時の降順で50件ずつ取得する。通常の会話と旧exec由来の会話を対象とし、サブエージェント専用の履歴は含めない。重複ID、循環カーソル、古い接続の応答を除外する。
- thread/readで作業フォルダーと稼働状態を確認し、thread/resume / thread/forkで読み込む。legacyとpaginatedを扱い、thread/turns/listとthread/items/listで省略された本文も取得する。
- 全本文の取得と表示変換が成功してから画面を切り替える。失敗時は元の会話を保持する。ユーザー発言、回答、推論、コマンド出力、差分などは同じ時系列へ復元する。
- thread/name/set、thread/archive、thread/unarchiveを接続する。旧UIメッセージのsession/deleteはアーカイブを意味し、永久削除には対応させない。アーカイブ済みの行は解除してから開く。
- 実行中・会話切替中の履歴変更は無効化する。復元後はサーバーが返した設定へ切り替え、同じthreadで続行できる。
- 一覧の切替、次ページ、名前の入力・保存・取消を既存の履歴ペインに追加した。

### 履歴の制限

Codex 0.154.0の実接続で、Forkの成功応答とthread/readには存在する会話がthread/listにはまだ現れないケースを確認した。接続中はサーバーの成功応答をメモリー上で補い、一覧に現れた時点で補完情報を破棄する。本文や履歴データベースは拡張機能側に複製しない。再接続後の一覧はCodexが返す範囲になり、未送信のForkが表示されない場合がある。

別プロセスで動いている会話を引き継いで操作する機能は提供しない。接続先がactiveと報告する会話、または復元中に新しいturn/startedが届いた会話は切替を中止する。画像添付の履歴はプレースホルダー表示で、添付内容を再送用の入力欄へ戻さない。

実接続の履歴検証は `pnpm test:codex:history` で実行する。専用cwdの会話を作成し、一覧・名前変更・復元・Fork・アーカイブ・解除・続行を確認する。モデル使用量が発生し、テスト自身が作った会話だけを最後にアーカイブする。

### Phase 3の確認結果

- Lint・Host / Webview / Story / テストの型検査と、ツール設定の型検査が成功。
- 単体90件、実際のExtension Hostによる結合テスト2件が成功。ページ重複・循環、復元失敗時の保持、外部ターンとの競合、接続切替後の遅い応答を含む。
- 履歴・App ServerのUIテスト14件が成功。選択範囲と入力欄の見た目を調整した後、履歴の9件を再実行して成功した。320px / 1000pxの明暗テーマ、名前入力、アーカイブ済みの画像を開いて確認した。
- 変更前は履歴非対応時の無効ボタンをクリックする既存テスト1件が失敗していた。無効であることを検証する内容へ修正した。
- Codex実接続で一覧・名前変更・保存済み本文の復元・Fork・アーカイブ・解除・復元後の続行が成功。
- Windows x64用VSIXを生成し、隔離プロファイルへのインストール後に返信・停止・続行・新規会話・履歴復元・名前変更・アーカイブ・解除が成功した。アーカイブと解除後の実画面も確認した。

UIの変更前は `dist/ui-review-history/app-server-phase3-2cb3332eb7864834aad491f32cd9e538/before/`、変更後の画像・レポートは `dist/ui-review/`、インストール検証の画像は `dist/installed-app-server-phase3/` に保存した。

## 実行基盤と配布

@openai/codexは0.154.0に完全固定し、src/codex-app-server/version.jsonに型の生成元を記録する。ネイティブcodex.exeをシェルなしで起動し、既存の認証・CODEX_HOME・設定を継承する。未認証の場合は同じユーザー環境のCLIでログインしてから再接続する。experimentalApiとrequestAttestationは無効にする。

App Server資産はdist/runtime/node_modules/@openai/に配置する。ビルドはWindows x64を検証し、直接依存のCodex 0.154.0と対応するネイティブ資産を実体コピーする。生成先dist/runtimeを検証して作り直すため、前のビルドの旧アダプター・別バージョンのCodexは残らない。出力先が別フォルダーへのリンクならビルドを中止する。

## 検証

```powershell
pnpm codex:generate
pnpm check
pnpm test:unit
pnpm test
pnpm package:vsix
pnpm test:codex
pnpm test:codex:chat
pnpm test:codex:history
pnpm ui-review sessions app-server --workers=1
```

型の再生成は固定した直接依存のCLIを使い、--experimentalを付けない。生成物はコミット対象とし、手書きコードの整形から除外する。
test:codexの前にはcompileまたはpackage:vsixで実行資産を準備する。同テストはモデルを呼び出さない。
test:codex:chatは実モデルを使用する。隔離した作業フォルダー・読み取り専用sandboxで、返信・停止・同じthreadでの続行を検証する。

Phase 1の単体テストは64件、UIテストは13件が成功した。開始前のStop、早い完了、古い通知、承認IDの照合・解消、再接続を含む。
UI変更前の画像はdist/ui-review-history/app-server-phase1/before/、変更後はdist/ui-review/に保存した。変更前の並列実行ではStorybookのロード待ちが5件タイムアウトしたため、変更後の13件は1 workerで検証した。320px幅の承認UIも画像を開いて確認済み。

インストール済みVSIXの検証には、隔離したCODEX_SMOKE_ROOT配下のextensionsにVSIXをインストールし、VSCODE_EXECUTABLEを指定してnode tests/installed-smoke.mjsを実行する。

## Phase 4: 旧ACP実装と実行資産の削除

- @agentclientprotocol/codex-acpと@agentclientprotocol/sdkをdependenciesとlockfileから削除した。
- src/extension/acp/と旧セッション制御を削除した。状態ストアと時系列番号は共通処理として保持し、フォルダー照合はworkspace.tsへ移した。添付サービスはCodexFilesを利用する。
- 旧ACP専用のフィクスチャ・単体テスト・test:acpを削除した。通信境界、ワークスペース検証、時系列表示、Webview再表示の回帰テストはApp Server構成へ引き継いだ。
- 使われなくなったcodex-acp.nodePath設定を削除した。拡張機能ID・コマンドIDは既存のインストールやキーバインドとの互換性のため維持する。
- runtimeの生成先を一本化した。Extension Hostの結合テストで、App Serverの起動と配布資産の構成を確認する。
- npm配布に含まれないCodex 0.154.0のLICENSE・NOTICEを公式リリースから取得し、同梱Codexのディレクトリに配置する。取得元はconfig/licenses/README.mdに記録した。

### Phase 4の確認結果

- Lint・Host / Webview / Story / テスト / 開発ツールの型検査が成功。
- App Serverと共通処理の単体59件、Extension Hostの結合3件が成功。旧ACP専用のテストは削除した。
- VSIX内のCodex実行ファイルが1つで、旧アダプターと旧資産を含まないことを確認。VSIXは約271.76 MBから約136.22 MBになった。
- 隔離したVS Codeへインストールし、返信・停止・続行・新規会話・履歴復元・名前変更・アーカイブ・解除が成功。画像はdist/installed-app-server-phase4/に保存した。

残る機能上の制限はPhase 2・Phase 3の各節に記載した範囲となる。

現在はCollaboration modeの変更を無効にする。未対応のserver requestには-32601を返す。

プロトコルの参考: [公式 App Server ドキュメント](https://learn.chatgpt.com/docs/app-server)。実装時の型は同梱CLIの生成物を基準にする。

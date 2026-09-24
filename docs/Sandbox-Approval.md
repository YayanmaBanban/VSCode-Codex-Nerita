# Phase 11: Sandbox / Approval

## 2026-09-24 security boundary review 修正後の状態

**この節が現在の動作です。以降の初期実装・実機確認の節は修正前の記録です。**

### 再レビューの残件3件への追加修正

- **自動コンテキスト**: SDKのAGENTS・SYSTEM・APPEND_SYSTEMの探索と直接読込みを無効化し、workspace内の祖先に限定したHost loaderからWorkspacePathPolicyとWin32 brokerを通す。本文はSDKのgetterへ直接渡し、本文をファイルパスとして再解釈させない。reloadでも同じ検査を行い、失敗時には以前のsnapshotを公開しない。workspace外の祖先やglobal agentDirの指示ファイルは取り込まない。
- **承認後のUnicode変換**: 各Toolの実行scopeへ承認済みcanonical pathを固定し、SDKが要求する各I/Oと厳密比較する。mkdirはwrite対象の親、lsのstatは列挙対象の直下だけを追加許可する。NBSPの通常空白への変換やreadのNFD別名探索で対象が変わった場合は、読書き前に再承認エラーにする。
- **移設CODEX_HOME**: 既定の`~/.codex`に加えて環境変数が指定する実体パスをread/write両方の保護対象にする。未作成の指定先も既存祖先から解決して保護する。相対指定はApp Serverのcwdによって対象が変わるため、policy生成を拒否する。

skills/promptsにもSDKが本文を直接読む経路があるため、**Piのskills/prompts自動探索・スラッシュコマンド展開は停止**する。通常のファイルツールからworkspace内の資料を読むことはできる。

追加テストは実SDKを使用する。ファイルsymlinkはこの環境で作成権限がないため実体解決を模擬し、`.pi`のjunction・AGENTSのhard link差し替え・通常コンテキストのbroker読取りは実filesystemで検証する。テストは一時fixtureの模擬データだけを使い、秘密情報を読んだり送信したりしない。

| 攻撃経路                                                        | 現在の対処                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| canonical path検査後のjunction・symlink差し替え                 | 固定Win32 brokerでdriveから親ディレクトリを順に開き、共有削除・共有書込みを許可せずI/O終了まで保持する。reparse pointを追跡せず拒否する。                          |
| 最終ファイルのhard link・差し替え・truncate                     | 同じハンドルの実体パス・種類・link数を検証してから読書きする。検証前にはtruncateしない。hard linkの読取りも拒否する。                                              |
| ADS、ドライブ相対パス、予約名、短縮名、case-sensitive directory | Hostとbrokerで特殊パスを拒否し、brokerでハンドルの実体名を照合する。case-sensitive directoryとUNCは未対応として拒否する。                                          |
| Stop後のSDK mkdirや画像読取り                                   | mkdir・stat・ls・画像判定もbrokerへ統一する。現在の承認signalを伝播し、終了を確認してから結果を返す。                                                              |
| localhost失敗を通信遮断成功と誤認                               | curlの終了コード7/28を隔離の証明にしない。プローブは実行許可を発行しない。                                                                                         |
| ShellからreadableRootsを迂回                                    | 現行command/execは有限のreadableRootsを表現できないため、workspace policyのcommandをdenyにする。Executorへ直接渡されたsandboxed要求も接続前に拒否する。            |
| 許可済み拡張の書換え、依存コード、Host直接実行、独自subagent    | 外部Pi拡張のロードを停止する。trustedExtensionPathsが空でなければ起動を拒否する。拡張Toolの直接実行もApproval Guardで拒否する。VSIX内の固定builtinのみロードする。 |
| 子Runtimeの親policy省略                                         | parentPolicyを必須とし、起動前にsnapshotを固定する。workspace上限 ∩ parentPolicy ∩ 任意のrole policyを適用する。                                                   |
| 次回Hostロード用のコード・認証設定を書き換える                  | extensionPath/distとPi agentDirをruntimeの保護対象に追加する。                                                                                                     |

ファイルbrokerの要求はJSONをstdinで渡し、ファイル名・内容をPowerShellソースへ埋め込まない。Windows標準PowerShellで固定C#コードだけを起動し、profile・workspaceのmodule探索・provider tokenの継承を避ける。任意のagent commandをHostで実行するfallbackではない。

### 利用上の変更

- Piのread / ls / write / editはWindowsのローカル通常ディレクトリで利用できる。write / editは従来どおり毎回承認が必要。
- **Pi PowerShellと外部Pi拡張は現在利用できない。** 実行制約を強制できる基盤が導入されるまで、承認やnetwork許可で解除できない。
- subagentの外部拡張や独自CLIをロード・起動する経路も閉じる。将来の共通Runtime呼出しでは親policyを明示的に渡す。
- UNC、case-sensitive directory、reparse pointを残した経路、hard link、共有モードを取得できない対象は拒否する。Hostでcanonical pathへ解決できた通常ディレクトリへのaliasは実体パスで扱う。
- readの上限は32 MiB。brokerはI/OごとにWindows PowerShellと固定C#を起動するため、従来の直接Node I/Oより遅い。
- この修正はPiのPhase 11経路が対象。Codex backend全体への独自Trust/origin管理の導入、外部取得物のTrust UI、完全な任意コードsandbox化は含まない。

### 回帰検証

`pnpm test:unit`でWindows特殊パス、hard link読取り、承認snapshot、permit再利用、親policy省略、外部拡張拒否、Shell fail closedを検証する。`windowsFileBroker.test.ts`は実Win32 I/OでUTF8読書き・新規階層・検査後のjunction/hard link差し替えと、固定中の親ディレクトリのrename拒否を検証する。

`pnpm test:pi:chat`は配布SDKとローカル模擬モデルでread / ls / write / edit、承認・拒否・Stop、保存・再開、外部拡張をロードしないこと、PowerShellが承認前に失敗しファイルを作成しないことを検証する。`NERITA_EXPECT_SANDBOX_UNAVAILABLE`による条件分岐は使用しない。旧`test:sandbox`はSandboxエンジンそのものの診断用であり、現在のPi Shell機能の成功条件ではない。

brokerの共有モードは[Microsoft CreateFile仕様](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)に基づく。管理者・kernel・別のHostコードによる任意メモリ操作からExtension Host自体を保護する仕組みではない。

## 以下は修正前の初期実装の記録

PiのTool Approvalと実行範囲の制限をExtension Hostで分離する。

```text
Pi tool
  → WorkspacePathPolicy / ApprovalGuard
  → frozen ApprovedToolCall（fingerprint・一回限り・AbortSignal）
  → PowerShell: SandboxCommandExecutor → Codex command/exec
  → File tool: canonical pathの再検査 → 検査付きSDK file operations
```

## 初期の方針

- 許可rootはVS Codeの現在のローカルworkspace folders。再接続・履歴復元でも作り直す。
- `read / ls` はworkspace内で許可、workspace外は拒否する。
- `write / edit` はworkspace内でも毎回承認する。workspace外・保護対象・root自体・hard linkへの書込みは拒否する。
- `powershell` は毎回承認し、`workspaceWrite`、network無効、TEMP追加許可なしで実行する。
- 書込みrootが空の子policyでは`readOnly`を使う。`cwd`の暗黙追加による書込み権限拡大を拒否する。
- 子agent用policyは`intersectAccessPolicies(parent, role)`で作り、`PiRuntimeOptions.accessPolicy`へ渡す。Runtimeはさらに現在のworkspace上限との交差を取る。
- command、引数、cwd、env、timeout、policyを承認前にコピー・固定する。改変・偽造・permit再利用は拒否し、呼出元が新しい要求として再承認する。
- Shellへprovider token等の環境変数を継承しない。Shellは`-NoProfile -NonInteractive`で起動する。
- Sandbox未設定・未対応policy・切断・拒否・Stopでは実行しない。通常のHost PowerShellへのfallbackはない。

`WorkspacePathPolicy`は既存祖先のrealpath、Windows case、separator、UNC、junction、存在しない新規階層を扱う。device namespace、ADS、予約名、末尾の空白・ピリオドなどの曖昧なWindowsパスは拒否する。

## Windowsの実行

Codexの`elevated` Windows Sandboxを使用する。Executorの専用App Server接続に設定を固定し、`windowsSandbox/readiness`が`ready`のときだけ実行する。さらにnetwork無効時は、固定のnative curlとHostの一時HTTP listenerで通信隔離を検査する。接続できる、検査ツールが動かない、結果が不明な場合はagent commandを起動しない。検査はprovider認証や外部サービスを必要とせず、秘密情報も送信しない。実行ごとに専用接続を持ち、Stop・disconnect・timeout後はプロセスツリーを回収してからツールを終了する。モデル認証やthread作成は不要。

セットアップは管理者設定を変更するため自動実行しない。開発環境では明示的に次を実行できる。

```powershell
node tests/sandbox-setup.mjs
pnpm test:sandbox
```

通常のPowerShell 7を優先し、見つからなければWindows PowerShellを使用する。Microsoft Store / MSIX版のPowerShellはSandbox専用ユーザーから起動できないため候補から除外する。検証用のportable版は`NERITA_SANDBOX_PWSH`で`test:sandbox`へ指定できる。これは製品の設定ではない。

同梱CodexではWindows Sandboxの`outputBytesCap`個別指定とstreaming `command/exec`は未対応。既定上限を使い、stdout / stderrはコマンド終了時にまとめて表示する。実行中のStopは利用できる。Sandboxの拒否はRPC errorとして返る場合があり、その場合はツールの失敗になる。

## Pi Extension Trust

`nerita.pi.trustedExtensionPaths`の**ユーザー設定**で明示した絶対パスの拡張ファイルだけをロードする。global・workspaceとも暗黙の拡張探索は無効。フォルダーやnpm指定を信頼対象にせず、新しく置かれた別ファイルへ許可を継承しない。Nerita組み込み拡張は従来どおり注入する。

この設定は外部JavaScriptと依存コードの**Host権限での実行**を許可する。Workspace Trustや個別Tool Approvalとは別の許可であり、Sandbox内での実行を意味しない。信頼済み拡張が登録するツールにも共通Approval Guardを適用する。組み込みのread / ls / grep / find / write / edit / powershell / bashの上書きは拒否する。

## 境界と後続フェーズ

会話開始時のパッケージ探索には、導入済みリソースの実体パスだけを渡す。未導入のnpm / gitパッケージを自動取得・インストールしない。導入・更新はPi CLIで明示的に実施する。

- `workspaceWrite`はOSで書込み範囲とnetworkを制限するためのpolicy。ただしnetwork無効の指定だけではlocalhostを含む遮断を保証できず、下記の実機検証でも未達成。Shellの読取りを`readableRoots`に限定する機構ではない。`readableRoots`はファイルツールのHost検査で使う。
- ファイルツールは承認前後と各I/Oでrealpathを検査する。Host内のI/Oなので、悪意ある別プロセスによる検査直後の継続的なパス差し替えをOS Sandboxと同等に隔離するものではない。
- 信頼済みPi拡張自身のNode.js実行、依存コード、拡張が独自に起動するsubagentをSandbox化する機能は含まない。共通Runtimeから作るsubagentにはpolicyの交差を適用できる。外部拡張の独自実行にこの保証は適用できない。
- Phase 11-1のJev接続・詳細な危険command解析、Phase 11-2の外部取得物のorigin管理・Trust変更UIは別フェーズ。今回は共通Guardと保守的な毎回承認、明示的なExtension Trustを実装する。

## 検証

単体テストは境界逸脱・junction・hard link・新規path・multi-root・Windows特殊path・policy交差・承認待機中の改変・permit再利用・取消・Sandbox未設定を確認する。

`test:sandbox`は専用fixtureだけで、workspace内作成、workspace外作成・削除の拒否、cwdと子プロセス経由の逸脱拒否、network拒否、標準出力・標準エラー・終了コード、Stop・timeoutを検証する。実際のdrive rootやユーザープロファイルの削除は試行しない。

`test:pi:chat`は同梱SDKとローカル模擬モデルを使い、承認UIからwrite / edit / Sandbox PowerShellへの接続を検証する。

### 2026-09-24の実機確認と未達成の通信隔離

Windows Sandboxの管理者セットアップは成功し、readinessは`ready`。Windows PowerShell、portable pwsh、native executableでworkspace内の書込みとworkspace外の作成・削除の拒否を確認した。cwd変更・子プロセスによるworkspace外書込みも拒否された。

一方、このPCではCodexのofflineユーザーからlocalhostと外部HTTPへの接続が成功した。WindowsのCodex用FirewallルールはEnabledでも、ActiveStoreの`EnforcementStatus`は`CategoryDisabled`。Security CenterにはESET Firewallが登録されていた。セットアップの完了だけで通信隔離を保証できないため、追加した事前検査ではPowerShellをfail closedする。セキュリティ製品の無効化やPC全体のFirewall変更は実装に含めていない。

原因についての訂正: ESETの登録と`CategoryDisabled`だけでは、通信隔離の不成立全体をESETに帰属できない。[2026-09-14の検証報告](https://note.com/juicy_daphne2674/n/n9abc98b6eb16)では、第三者製Firewallとの競合を解消して通常のOutbound Block ruleが適用された状態でもlocalhost接続が成功し、外部TCPは遮断された。これは通常ruleによるloopback制御の制約を示す実測であり、全Windows環境に共通する公式仕様の確定ではない。このPCでは外部HTTPも成功しており、その原因はlocalhostの問題とは分けて未確定とする。Firewallの設定変更だけで解決するとは扱わない。

この状態では通常の`test:sandbox`とPowerShell成功を要求する`test:pi:chat`は完了できない。`NERITA_EXPECT_SANDBOX_UNAVAILABLE=1`を明示した`test:pi:chat`では、PowerShellが「通信隔離を確認できない」と失敗し、対象ファイルが作成されないことを代わりに検証する。これはSandbox成功・実行中Stop検証の代替ではない。localhostと外部通信の両方を遮断できる実行方式が確認できた時点で、この変数を設定せず両smokeを再実行する。現在の事前検査はlocalhostへの到達を検出するもので、外部通信の遮断まで証明する検査ではない。

UIレビューは320px・明暗テーマで8件。承認・拒否・ターン中止・停止を確認し、変更前後の画像を開いて確認。初回はStorybook依存最適化の504が発生したが、再実行ではconsole / page errorなし。成果物は`dist/ui-review/report`、変更前は`dist/ui-review-history/phase11-20260924/before`。

実行API: [Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Windows Sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)

# Pi ガードレールの初期実装

仕様との照合、子・孫の結合検証、`pi-subagents` の Host アダプターとの境界は [Phase 11-1 の確認記録](Phase-11-1-Review.md) にまとめた。

## 操作

コマンドパレットの `Nerita: Pi ガードレールを編集` で、選んだ workspace の `.pi/guardrails.json` をエディタグループに開く。ファイルがなければ既定設定を作る。複数の workspace がある場合は対象を選択する。

- ルール編集と JSON 表示は同じ文書を編集する。未保存状態と VS Code の文書バージョンを共有する。
- 「保存」はファイルへ保存する。これだけでは実行設定を変更しない。
- 「適用」は保存済み文書を検証し、workspaceState に記録して共通 Guard へ反映する。旧設定での承認待ち・実行中の処理は取消しの対象になる。
- 「検査」は編集中の設定を検証し、Tool・対象パスまたはコマンド・cwd の入力例を判定する。コマンドや書込みを実行しない。実パスの解決にはファイルシステムのメタデータを使用する。
- 再起動時は最後に適用した設定を復元する。ファイルの直接編集、Git からの取得、エージェントによる変更を自動適用しない。復元できない設定では実行を停止し、エディターからの再適用を要求する。

## スキーマと配置

`src/shared/guardrails/config.ts` の Zod 定義を正本にする。`pnpm guardrails:generate` で `src/extension/backends/pi/guardrails/schema.json` を生成する。ビルド時に `dist/guardrails.schema.json` へコピーし、JSON 編集時の検証にも関連付ける。配布スキーマと実行時定義の一致を単体テストで検証する。

| 項目                      | 意味                                                 |
| ------------------------- | ---------------------------------------------------- |
| `version`                 | 初期版は `1`                                         |
| `pathAccess.outsideRead`  | 外部読取りの既定。初期値は `deny`                    |
| `pathAccess.outsideWrite` | `deny` 固定                                          |
| `pathRules`               | ID、基準、照合方法、パターン、例外、操作、判定、理由 |
| `commandRules`            | ID、対象 Shell、部分一致させる文字列、判定、理由     |

パスの基準は `workspace` または `home`。設定中のパスは相対形式で、区切りは `/` とする。ドライブ指定、上位参照、バックスラッシュを拒否する。`file` は完全一致、`directory` はディレクトリ自身と配下、`glob` はワイルドカードで照合する。単一のアスタリスクは階層をまたがず、二重のアスタリスクは階層をまたぐ。区切りを含まないパターンはファイル名で照合する。

例外は同じパスルールだけに適用する。複数ルールに一致すると `deny > ask > allow` を優先する。外部読取りの個別例外は、リンクの表記だけでなく実体への一致も必要とする。任意の正規表現は初期版では受け付けない。コマンドの追加ルールは大文字・小文字を区別しない部分一致とする。

Host の Pi 固有処理は `src/extension/backends/pi/guardrails/` に置く。共通判定は `src/extension/security/`、通信契約は `src/shared/guardrails/`、UI は `src/webview/pi/guardrails/` に置く。参考スキーマの設定ファイルとの互換性は保証しない。

## 実行経路

`read / ls` を SDK の標準ツールから Guard 付きのアダプターへ置き換える。承認前に表記と実体を検査し、承認後にもリンク先を確認する。read は開いたハンドルの識別情報を検査してから取得した内容を SDK へ渡す。ls は子のリンク先へ追従しない。

既存の `write / edit / powershell / pwsh / bash` と登録拡張 Tool は共通の `approveToolCall` で設定を検査する。設定の digest を承認対象の fingerprint に含め、設定の世代ごとの AbortSignal を許可の寿命へ結び付ける。Host 管理の子 Runtime は親の `guardrailsRoot` を維持し、cwd の変更で別ルートの緩い設定へ切り替えない。

初期版では write/edit・Shell・拡張 Tool の毎回承認を維持する。`allow` ルールでこの承認や Sandbox の書込み上限は解除しない。認証情報のディレクトリと Git の認証情報ファイルは組込みルールで拒否する。ファイル Tool から設定自体への書込みも拒否する。

## 範囲と制約

Shell は既知の破壊的操作とリテラルのパス引数を検査する。変数、ワイルドカード、スクリプト、別プログラム内部のファイルアクセスは解析対象に含まれない。判定できない範囲を承認画面へ表示し、Shell は原則 `ask` を維持する。OS による外部 Read の隔離は追加していない。

Host によるパス検査と I/O の間には競合の余地がある。拡張 JavaScript の直接アクセスや、外部拡張が独自に起動するサブエージェントは、この Guard の強制境界には含まれない。

Jev は任意の補足判定として接続準備を追加した。既定は未接続で、認証と実サービスの検証は Jev が準備でき次第行う。詳細は [Jev 補足判定の接続準備](Jev-Guard.md) を参照する。永続的な Shell prefix 許可、ツールのメタデータによる拡張 Tool の自動許可は対象外。検索 Tool の新規公開も行わない。

## 検証

- `pnpm check`：Lint、本体・Webview・Storybook・テストの型検査。
- `pnpm test:unit`：判定、設定復元、許可失効、junction、実 SDK の read と既存機能。
- `pnpm test`：実 Extension Host の起動・Pi SDK・停止を含む結合検証。
- `pnpm test:runtime`：配布入口に read / ls の定義を含めたことを検証。
- `pnpm ui-review pi-guardrails`：明暗・320px/1100px、フォーム・JSON・検査・保存・適用。生成画像も目視確認する。
- `pnpm test:guardrails:ui`：専用プロファイルの実 VS Code で作成、Host 判定、適用、再起動後の復元、外部変更の未適用を検証。
- `pnpm textlint:changed`：変更した日本語コメントと文書。

UI の成果物は `dist/ui-review/`。実 VS Code の結果と画像は `dist/guardrails-vscode/`。初回の実機検証で見つかった選択欄のアクセシブル名と、配布 SDK の公開 API の不足は修正した。実機の再起動検証は、古い Webview の終了を待ってから復元状態を確認する。

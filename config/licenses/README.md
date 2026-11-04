# 配布用ライセンスと更新手順

対応版の Codex と同梱する Pi のライセンスは、各バージョンに対応するリリースから取得し、内容を変更せずに保存しています。

Codex 本体は VSIX に含めません。対応版が導入済みなら再利用し、未導入または導入版が対応版より新しい場合は、同意後に専用領域へダウンロードします。導入版が対応版より古い場合は、更新を案内して接続を中止します。

| 製品 | 保存先 | 取得元 |
| --- | --- | --- |
| Codex 0.164.0 | `codex-0.164.0/LICENSE`、`codex-0.164.0/NOTICE` | [LICENSE](https://raw.githubusercontent.com/openai/codex/rust-v0.164.0/LICENSE)、[NOTICE](https://raw.githubusercontent.com/openai/codex/rust-v0.164.0/NOTICE) |
| Pi 1.5.0 | `pi-1.5.0/LICENSE` | [LICENSE](https://raw.githubusercontent.com/earendil-works/pi/v1.5.0/LICENSE) |

更新コマンドはプロジェクトのルートで実行します。以下の例では、Codex の現在の対応版と Pi の同梱版を指定しています。別の版へ更新する場合は、変数の値を更新先のバージョンに置き換えてください。

## Codex を更新する

```powershell
$codexVersion = "0.164.0"
pnpm codex:generate $codexVersion
pnpm check
pnpm package:vsix
```

最新版へ更新する場合は、バージョンを指定する代わりに `pnpm codex:generate --latest` を実行します。生成した通信型に変更があれば、利用側を修正してから検証してください。

## Pi を更新する

```powershell
$piVersion = "1.5.0"
pnpm pi:generate $piVersion
pnpm pi:verify
pnpm package:vsix
```

最新版へ更新する場合は、バージョンを指定する代わりに `pnpm pi:generate --latest` を実行します。生成後は互換処理と差分を確認してください。

## 生成コマンドの動作

`pnpm codex:generate` と `pnpm pi:generate` は、引数に応じて次のように動作します。

| 引数 | 動作 |
| --- | --- |
| バージョン番号 | 対象の依存を指定した固定版へ更新して生成します。 |
| なし | 依存を更新せずに現在の固定版で再生成します。 |
| `--latest` | レジストリの `latest` タグからバージョンを取得し、対象の依存を更新して生成します。 |

`codex:generate` は公式リリースから `LICENSE` と `NOTICE` を取得して通信型を生成します。また、Windows x64 用 npm 資産の固定 URL・SHA-512・展開サイズを `version.json` に保存します。この情報は VSIX に含め、実行時の取得元とハッシュの照合に使用します。

`pi:generate` は公式リリースから `LICENSE` を取得し、バンドル対象ソースのハッシュを更新します。

取得にはネットワーク接続が必要です。取得に失敗した場合は旧版のファイルで代用せず、リリースタグと接続を確認してください。

`pnpm package:vsix` は本番ビルドを実行し、`apps/vscode-nerita/dist/nerita.vsix` を生成します。`pnpm package` は本番ビルドのみです。依存、ロックファイル、生成型、取得情報、ハッシュ、ライセンスを一緒にバージョン管理してください。

生成と保存が成功すると、各生成コマンドは対応する製品の旧版ライセンスを削除します。取得・生成・保存に失敗した場合は旧版を残し、他製品や依存ライブラリのライセンスは削除しません。更新後は、この文書の版と取得元リンクも合わせて更新してください。

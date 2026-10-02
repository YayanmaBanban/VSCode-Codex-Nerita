# 配布用ライセンスと更新手順

同梱する Codex と Pi のライセンスは、各バージョンに対応するリリースから取得し、内容を変更せずに保存しています。現在の保存先と取得元は次のとおりです。

| 製品 | 保存先 | 取得元 |
| --- | --- | --- |
| Codex 0.160.0 | `codex-0.160.0/LICENSE`、`codex-0.160.0/NOTICE` | [LICENSE](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/LICENSE)、[NOTICE](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/NOTICE) |
| Pi 1.0.0 | `pi-1.0.0/LICENSE` | [LICENSE](https://raw.githubusercontent.com/earendil-works/pi/v1.0.0/LICENSE) |

更新コマンドはプロジェクトのルートで実行します。以下のバージョンは現在の同梱版の例です。別の版へ更新する場合は、変数の値を更新先のバージョンに置き換えてください。

## Codex を更新する

```powershell
$codexVersion = "0.160.0"
pnpm codex:generate $codexVersion
pnpm check
pnpm package:vsix
```

最新版へ更新する場合は、バージョンを指定する代わりに `pnpm codex:generate --latest` を実行します。生成した通信型に変更があれば、利用側を修正してから検証してください。

## Pi を更新する

```powershell
$piVersion = "1.0.0"
pnpm pi:generate $piVersion
pnpm pi:verify
pnpm package:vsix
```

最新版へ更新する場合は、バージョンを指定する代わりに `pnpm pi:generate --latest` を実行します。生成後は互換処理と差分を確認してください。

## 生成コマンドの動作

バージョンを指定した場合、生成コマンドは対象の依存を固定版へ更新します。`pnpm codex:generate` または `pnpm pi:generate` を引数なしで実行した場合は、依存を更新せずに現在の固定版で再生成します。`--latest` を指定した場合は、レジストリの latest タグから版を取得します。

`codex:generate` は公式リリースから `LICENSE` と `NOTICE` を取得して通信型を生成します。`pi:generate` は公式リリースから `LICENSE` を取得し、バンドル対象ソースのハッシュを更新します。取得にはネットワーク接続が必要です。取得に失敗した場合は旧版のファイルで代用せず、リリースタグと接続を確認してください。

`pnpm package:vsix` は本番ビルドを実行し、`dist/nerita.vsix` を生成します。`pnpm package` は本番ビルドのみです。依存、ロックファイル、生成型、ハッシュ、ライセンスを一緒にバージョン管理してください。

生成と保存が成功すると、各生成コマンドは対応する製品の旧版ライセンスを削除します。取得・生成・保存に失敗した場合は旧版を残し、他製品や依存ライブラリのライセンスは削除しません。更新後は、この文書の版と取得元リンクも合わせて更新してください。

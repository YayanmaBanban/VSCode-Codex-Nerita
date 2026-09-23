# Codexの配布用ライセンス表記

`codex-0.156.0/LICENSE` と `codex-0.156.0/NOTICE` は、同梱バージョンに対応する公式リポジトリのファイルを変更せずに保存したものです。

- [LICENSE（rust-v0.156.0）](https://raw.githubusercontent.com/openai/codex/rust-v0.156.0/LICENSE)
- [NOTICE（rust-v0.156.0）](https://raw.githubusercontent.com/openai/codex/rust-v0.156.0/NOTICE)

`package-runtime.cjs` が `dist/runtime/node_modules/@openai/codex/` にコピーします。Codexのバージョン更新時は対応するリリースの表記も更新してください。

## 更新手順（Windows PowerShell）

プロジェクトのルートで実行します。`$codexVersion` は更新先のバージョンに置き換えてください。

```powershell
$codexVersion = "0.156.0"
pnpm codex:generate $codexVersion

pnpm check
pnpm package:vsix
```

各コマンドの成功を確認してから次へ進んでください。生成型に変更があれば利用側を修正します。取得したファイルは編集せず、この文書のバージョンと取得元リンクも更新してください。

バージョンを指定すると、内部で `pnpm add --save-exact @openai/codex@<バージョン>` を実行してから通信型を生成します。引数を省略した `pnpm codex:generate` は依存を更新せず、現在の固定バージョンで再生成します。依存の更新に失敗した場合は後続処理を実行しません。

`pnpm codex:generate` は、固定した依存と同じ公式リリースタグから `LICENSE` と `NOTICE` を取得し、`config/licenses/codex-<バージョン>/` に保存します。実行にはネットワーク接続が必要です。取得に失敗した場合は通信型の生成前に停止します。リリースタグや接続を確認し、旧版のファイルで代用しないでください。

`pnpm package:vsix` は本番ビルドも実行し、`dist/nerita.vsix` を生成します。`pnpm package` は本番ビルドのみです。依存とロックファイル、生成型、ライセンスを一緒にバージョン管理してください。

生成と保存が成功した後、`codex:generate` は現在版以外の `codex-<バージョン>/`、`pi:generate` は現在版以外の `pi-<バージョン>/` を削除します。取得・生成・保存の失敗時は旧版を残します。他製品・依存ライブラリのライセンスとリンクは削除しません。

# Codex 0.157.0 の有限読取り検証

2026-09-26、Windows x64 の実機で実施した。**root-deny の採用は保留**。
同梱バイナリのバージョン表示は `codex-cli 0.157.0` だが、CLI と App Server の両方で次のエラーとなり、コマンドは起動しなかった。

```text
elevated Windows sandbox requires effective `:root` read access
```

## 再実行

```sh
pnpm test:sandbox:read-boundary
```

同梱ランタイムを配置済みの Windows x64 環境で実行する。対象は `dist/runtime` のバイナリであり、PATH 上の CLI は使用しない。実行時のバージョンを厳密に検証し、SHA-256 も記録する。モデル呼出しや会話作成は行わない。

結果は `dist/sandbox-read-boundary-smoke/report.json` に出力する。今回の保存結果は [JSON](Sandbox-Read-Boundary-0.157.0.json) を参照。

## 検証条件

- elevated backend をプロセス起動引数で指定する。
- 専用 permissions profile に `:root=deny`、`:minimal=read`、一時 workspace のみ `write`、network 無効を指定する。
- 対照は同じ設定の `:root=read`。Host からも外部 canary の内容を確認する。
- `codex sandbox -P` と App Server の `command/exec` を比較する。後者は専用 profile を既定にし、旧 `sandboxPolicy` で上書きしない。
- workspace の読取り・書込み、外部 canary の絶対パス・相対パス・junction・子プロセス経由の読取り、外部への書込み拒否を確認する。
- 権限拒否の例外と実行マーカーを検証する。起動失敗、ファイル不在、PowerShell の言語制約を読取り拒否の成功として扱わない。
- 操作対象は作成した一時フィクスチャに限定し、終了時に回収する。ユーザーの設定ファイルと製品の権限設定は変更しない。

## 結果

| 対象                  | 成功 | 失敗 | 内容                                           |
| --------------------- | ---: | ---: | ---------------------------------------------- |
| Host 対照             |    1 |    0 | canary の読取り成功                            |
| CLI、root=read        |    6 |    0 | workspace 操作・外部読取り成功、外部書込み拒否 |
| App Server、root=read |    6 |    0 | 同上                                           |
| CLI、root=deny        |    0 |    6 | 全件が実行前に root read 必須エラー            |
| App Server、root=deny |    0 |    6 | 同上                                           |

合計 13 件成功、12 件失敗。スモークテストの終了コードは 1。
有限読取りの OS 境界は未検証のままであり、外部読取りを遮断できたという結果ではない。

## 判断と残件

[0.157.0 タグの core README](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/core/README.md) は exact readable roots 対応を記載している。今回の配布バイナリでは異なる挙動を確認した。原因は未特定で、バージョン表示だけからソースとの一致を断定しない。

Phase 11 の本番設定は維持する。次に調べる対象は、配布バイナリとリリースソースの対応、および実行前のポリシー検証経路。コマンドを起動できる環境で本スモークを再実行し、有限読取りの実効性を確認する必要がある。今回の結果は通常のモデルによる exec ツール経路、Pi の Host I/O、ネットワーク隔離を保証しない。

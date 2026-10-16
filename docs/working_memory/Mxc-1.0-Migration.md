# MXC 1.0.0 の移行上の制約

## V1 の spawn と拒否イベント収集

Windows x64 / Node.js 24.21.0 / MXC 1.0.0 で、`spawn()` と ProcessContainer の `captureDenials` を併用すると、workload の終了後に呼出し元の Node.js が `0xC0000005`（アクセス違反）で終了する。製品経路だけでなく SDK 単独でも再現する。

`tests/scratch/mxc-v1.cjs` を `node tests/scratch/mxc-v1.cjs` で実行すると、次の条件を別プロセスで比較できる。診断結果は `dist/mxc-v1-diagnostic/result.json` に出力する。

| API | 拒否収集 | 結果 |
| --- | --- | --- |
| `spawn` | 無効 | 正常終了 |
| `run` | 有効 | 正常終了し、構造化された拒否収集情報を取得できる |
| `spawn` | 有効 | workload の出力後にアクセス違反で終了 |

`run()` への置換では途中出力と停止の契約を維持できないため、そのまま採用しない。拒否収集の無効化も、既存の拒否分類・権限追加・再試行の契約を失うため採用しない。

1.0.0 対応は未完了の作業として別ブランチに退避し、main は 0.9.0 を維持する。V1 のネイティブ実行へ切り替える条件は、この再現コードと既存の MXC 製品テストが成功すること。既存の専用パイプを使う CLI 経路での対応は代替案として調査したが、実装していない。

## 再開時に残る確認

- `pnpm test:product mxc-policy mxc-resource-retry` の 7 件は成功した。MXC 本体で実行する製品テストは、上記のアクセス違反が残るため未通過。
- `pnpm check` は未通過。旧ランチャーを参照する `tests/scratch/mxc-measurement.ts` の型不整合が残る。再開時には計測方法の移行と、リント・型チェックの再実行が必要。
- 現在の差分は V1 の `ContainerRequest` と `spawn` への移行途中。実行可能なリリースとして main に取り込まない。

## 公式資料

- [1.0.0 リリースノート](https://github.com/microsoft/mxc/releases/tag/v1.0.0)
- [1.0.0 Node.js SDK](https://github.com/microsoft/mxc/blob/v1.0.0/sdk/node/README.md)

公開 API の入口は `/v1`。Windows のネイティブ標準入出力は Node.js 24.21.0 以降（24 系）または 26.8.0 以降が必要。CLI の設定と V1 の公開リクエストは異なる契約として扱う。

# Phase 10-1 Reasoning Effort Override の再確認

2026-09-26、Codex 0.157.0 と Pi 0.87.1 を前提に再確認した。

## 判定と修正

`supportsReasoningEffortUpdates` は更新項目の受理能力を表す。指定した推論レベルへの反映が正常であることを保証するフラグとして扱わない。

以前の有効化条件は live metadata の明示的な `true`、Codex provider/API、公式 endpoint の一致だった。この条件だけで `configuration_update` を送信していた。現在は `gpt-6-astra` との一致も必要とする。この ID は Codex `rust-v0.157.0` の bundled metadata で `true` を確認したモデルを表す。この固定条件は当該バージョンの情報に基づく制限であり、「実サービスで検証済み」の一覧ではない。

- Astra：live の明示的な `true` と既存の endpoint 条件を満たす場合だけ更新項目を利用する。
- Sol / Luna / 未確認モデル：live が `true` でも通常の request-level `reasoning.effort` を維持する。
- モデル別名や将来の派生 ID は推測で許可しない。
- 非対応へ移ったときは保存済み baseline を無効化する。過去の版が保存した状態からも通常要求へ復帰する。
- ModelRuntime のモデル集合、Ultra、Fast Mode の判定は変更しない。

上流 Codex の feature flag と Nerita 独自の要求変換は別の実装として動作する。上流の default disabled が Nerita に自動適用されるわけではない。今回の修正は対象モデルの限定であり、Nerita 全体を default disabled にする変更ではない。

## 根拠と限界

- [上流 Issue #47843](https://github.com/openai/codex/issues/47843)：0.156.1 の実サービスで、更新の受理後も Sol / Luna の推論が通常の high と一致しないという報告。再確認時点で Open。Nerita での再現結果や、全アカウントへの影響を示すものではない。
- [0.157.0 bundled models](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/models-manager/models.json)：Astra の capability は明示的な `true`。Sol / Luna の当該値は未指定。
- [protocol の定義](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/protocol/src/openai_models.rs)：更新項目の受理能力であり、metadata 欠落時は通常の要求パラメーターを使う。
- [公式 Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)：更新時に request-level effort を維持する構成と、その利用条件を説明している。レスポンスの `reasoning.effort` は更新後の実効値を示す確認手段にはならない。

提示された Phase 10 の仕様も参照した。ModelRuntime をモデル集合の正本とし、live catalog を補助情報とする責務は維持する。外部仕様ページは更新していない。

bundled と live の両方で `true` でも意味的な正しさは保証されない。今回の条件は既知の懸念があるモデルと未確認モデルへの適用を防ぐ暫定策。拡張する際はバージョンを固定した metadata の再確認と、下記の実サービス検証が必要となる。

## 自動テスト

```sh
pnpm test:unit tests/unit/piReasoningOverride.test.ts tests/unit/piReasoningIntegration.test.ts
```

25 件成功。実 Pi SDK とローカル Responses サーバーで、次を確認した。

- Astra の baseline 維持、更新履歴、resume / fork / compaction。
- live=true の Sol / Luna でも low → high → low を要求パラメーターへ直接反映し、更新項目を送信しない。
- Sol / Luna の resume 後も high を要求パラメーターへ反映する。
- 未確認モデルの除外、古い baseline の無効化、Fast Mode との共存。

これは通信形式と fallback の検証であり、モデルの実際の推論量を検証したものではない。

## 別枠の受入項目：実サービスでの semantic smoke

**未実施。以下は実施手順と評価条件であり、自動テストの成功数に含めない。**

1. モデル ID、実行日時、Pi / Nerita の版、live capability、endpoint と transport を記録する。認証情報は保存しない。
2. ツールなし、同一 system prompt、同一の二段階質問を用意する。初回は短い応答、2回目は推論が必要な固定問題を使う。
3. 独立した会話で次の四条件を比較する。
    - low → low。
    - low → high を request-level effort で指定。
    - high → high。
    - low → high を `configuration_update` で指定し、request-level は low を維持。
4. 条件順を変えながら最低 5 ブロック繰り返す。条件ごとに会話を分け、前の条件の状態を引き継がない。
5. 送信直前の実際の payload を確認し、request-level effort、更新項目の値・位置・個数、継続方式を記録する。認証ヘッダーや個人の会話履歴は記録しない。
6. 2回目の応答について、reasoning token 数、回答、正誤、終了理由、所要時間を記録する。推論 token 数が取得できない場合はゼロへ置換せず、未取得とする。
7. low と通常 high の対照が十分に区別できなければ「判定不能」とする。更新経路だけが low 相当を繰り返す場合は不整合の疑いとして扱う。単発の token 増加や HTTP 成功だけで採用可と判定しない。

Sol / Luna の更新条件を調べる場合、診断専用の要求で試す。本番のモデル制限を解除して試験しない。まず Nerita の通常 fallback を実サービスで確認し、更新経路の比較は別に記録する。Astra についても同じ比較が必要となる。

この小規模比較は回帰の兆候を探すためのもの。token 数の一定倍率を全モデル共通の合否基準にせず、対照との差、ばらつき、問題への正答を合わせて評価する。対照との差がばらつきに埋もれて判定不能となる場合は、問題数と反復数を増やして再検証する。

# リポジトリの運用

- Notion のリンクをファイル内に残さない
- ローカルの絶対パスをファイル内に残さない。相対パスで扱う
- ユーザーの許可なしに `./README.md` と `./CHANGELOG.md` を更新しない
- 作業記録が必要な場合は `docs/working_memory/` に残す
    - 未解決の課題、見送った対応とその理由、今後の対応条件、設計判断の背景など、次の作業に必要な情報を記録する
    - レビュー結果は、未対応の指摘や継続して注意すべき点がある場合に記録する
    - 完了した作業の羅列、コマンドの実行履歴、既存の文書や Notion と重複する内容だけの記録は作成しない
    - 同じ話題の記録がある場合は既存ファイルを更新し、作業ごとにファイルを増やさない
- Notion にタスクがある場合は、作業後に最終的な実装を確認し、次を行う
    - 満たした完了条件にチェックを入れる
    - 作業記録を残した場合は、その内容を Notion に反映し、不要になった作業記録を削除する
- ソースコード変更に伴う実装が完了したら、`pnpm check` を行い、エラーと警告を修正する

# プロジェクトの指示

React の Webview は `apps/nerita-ui/src/`、Extension Host の処理は `apps/vscode-nerita/src/extension/` に置く。共通の通信型・検証処理は `packages/shared/src/` に置く。

Webview と Extension Host は責務を分け、検証済みのメッセージで通信する。

開発中に互換性を考える必要はない。

## 作業に応じた参照先

作業に該当する行の参照先を確認する。複数の行に該当する場合は、各参照先を併用する。

| 作業 | 参照先 |
| --- | --- |
| コードの追加・変更、依存調査・構造変更・コードレビュー、検証方針の決定・テスト作業、UI の変更・レビュー | [開発ガイドラインのスキルを使用](.agents/skills/development-guidelines/SKILL.md) |
| ソースファイルの追加・分割・移動・フォルダ整理、領域間の依存・通信境界、テーマ定義の変更 | [ディレクトリ構成](.agents/docs/Directory-Structure.md) |
| 検証方針の決定、テストや Webview UI の変更・レビュー | [プロジェクト固有の検証環境](.agents/docs/Project-Verification.md) |

## 実行環境

実行・配布は Windows x64 のローカル VS Code を前提とする。開発には Node.js 22.19.0以降を使う。Extension Host は VS Code 内の Node.js で動作する。

## 実行コマンド

リポジトリルートで `pnpm watch`、`pnpm check`（リント・型チェック）、`pnpm test`（製品経路のローカル検証）を実行できる。`pnpm compile` は開発ビルド、`pnpm package` は本番ビルドを行う。Windows で PowerShell の実行ポリシーにより `pnpm` を起動できない場合は `pnpm.cmd` を使う。

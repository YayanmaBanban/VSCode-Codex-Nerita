# リポジトリの運用

- Notion のリンクをファイル内に残さない
- ローカルの絶対パスをファイル内に残さない。パスは相対パスで記述する
- ユーザーの許可なしに `./README.md` と `./CHANGELOG.md` を更新しない
- 作業記録が必要な場合は `docs/working_memory/` に残す
    - 未解決の課題、見送った対応とその理由、今後対応する条件、設計判断の背景など、次の作業に必要な情報を記録する
    - レビュー結果は、未対応の指摘や継続して注意すべき点がある場合に記録する
    - 完了した作業の羅列、コマンドの実行履歴、既存の文書や Notion と重複する内容だけの記録は作成しない
    - 同じ話題の記録がある場合は既存ファイルを更新し、作業ごとにファイルを増やさない
- Notion にタスクがある場合は、作業後に最終的な実装を確認し、次を行う
    - 満たした完了条件にチェックを入れる
    - 作業記録を残した場合は、その内容を Notion に反映し、不要になった作業記録を削除する
- ソースコードの変更が完了したら、`pnpm check` を実行し、エラーと警告を修正する

## 静的解析ルールの変更制限

- ESLint 設定、独自ルール、ルールのテストは、ユーザーの明示的な承認なしに変更しない。
- ESLint エラーを解消するためにルールを無効化・緩和・除外してはならない。
- `eslint-disable` による回避を原則禁止する。
- 誤検出が疑われる場合は、対象コード・該当ルール・理由をユーザーに提示する。
- ルール変更が承認された場合は、正常系と異常系の回帰テストを追加・更新する。

# プロジェクトの指示

Svelte 5 の Webview は `apps/nerita-ui/src/`、Extension Host の処理は `apps/vscode-nerita/src/extension/` に置く。共通の通信型・検証処理は `packages/shared/src/` に置く。

Webview は Vite でビルドし、`src/index.ts` からマウントする。SvelteKit は使用しない。

Webview と Extension Host は責務を分け、検証済みのメッセージで通信する。

開発中に互換性を考える必要はない。

## 作業に応じた参照先

作業に該当する行の参照先を確認する。複数の行に該当する場合は、各参照先を併用する。

| 作業 | 参照先 |
| --- | --- |
| コードの追加・変更、依存調査・構造変更・コードレビュー、検証方針の決定・テスト作業、UI の変更・レビュー | [開発ガイドラインのスキルを使用](.agents/skills/development-guidelines/SKILL.md) |
| Svelte コンポーネント・runes モジュールの追加・変更・解析 | `svelte:svelte-code-writer` と `svelte:svelte-core-bestpractices` のスキルを使用し、公式 autofixer で確認する |
| Webview UI の作成・変更 | [プロジェクト固有の UI 実装](.agents/docs/UI-Implementation.md) |
| ソースファイルの追加・分割・移動・フォルダ整理、領域間の依存・通信境界、テーマ定義の変更 | [ディレクトリ構成](.agents/docs/Directory-Structure.md) |
| 検証方針の決定、テストや Webview UI の変更・レビュー | [プロジェクト固有の検証環境](.agents/docs/Project-Verification.md) |

## 実行環境

実行・配布は Windows x64 のローカル VS Code を前提とする。開発には Node.js 22.19.0 以降を使う。Extension Host は VS Code 内の Node.js で動作する。

## 実行コマンド

次のコマンドをリポジトリルートで実行できる。

| コマンド | 用途 |
| --- | --- |
| `pnpm watch` | 開発時の変更監視 |
| `pnpm check` | リント・型チェック |
| `pnpm test` | 製品経路のローカル検証 |
| `pnpm compile` | 開発ビルド |
| `pnpm package` | 本番ビルド |

Windows で PowerShell の実行ポリシーにより `pnpm` を起動できない場合は `pnpm.cmd` を使う。

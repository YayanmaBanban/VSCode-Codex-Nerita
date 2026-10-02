# リポジトリの運用

- notion のリンクをファイル内に残さない
- ローカルの絶対パスをファイル内に残さない。相対パスで扱う
- ユーザの許可なしに、`./README.md` と `./CHANGELOG.md` を更新しない
- 作業記録が必要な場合は `docs/working_memory/` に残す
    - 未解決の課題、見送った対応とその理由、今後の対応条件、設計判断の背景など、次の作業に必要な情報を記録する
    - レビュー結果は、未対応の指摘や継続して注意すべき点がある場合に記録する
    - 完了した作業の羅列、コマンドの実行履歴、既存の文書や Notion と重複する内容だけの記録は作成しない
    - 同じ話題の記録がある場合は既存ファイルを更新し、作業ごとにファイルを増やさない

# プロジェクトの指示

React の Webview は `apps/nerita-ui/src/`、Extension Host の処理は `apps/vscode-nerita/src/extension/` にあります。共通の通信型・検証処理は `packages/shared/src/` に置きます。

開発中に互換性を考える必要はありません。

## 作業に応じた参照先

コードの追加・変更、依存調査・構造変更・コードレビュー、検証方針の決定やテスト作業、UI の変更・レビューでは [開発ガイドライン](.agents/skills/development-guidelines/SKILL.md) スキルを使用してください。作業に該当するリファレンスだけを読んでください。

- ソースファイルの追加・分割・移動・フォルダ整理では [ディレクトリ構成](.agents/docs/Directory-Structure.md) を参照してください。
- 検証方針の決定、テストや Webview UI の変更・レビューでは [プロジェクト固有の検証環境](.agents/docs/Project-Verification.md) も参照してください。

Webview の色は既存のテーマ定義を使い、VS Code のテーマ変数への追従を維持してください。

## Webview UI と Extension Host の境界

UI ライブラリや Web 向けアニメーションは Webview に使用します。VS Code API・Node.js・Codex App Server プロセスの処理は Extension Host に置き、Webview とは検証済みメッセージで通信してください。共有する通信型・検証処理は `packages/shared/src/` に置き、React・DOM・VS Code API・Node.js 専用 API に依存させません。

実行・配布は Windows x64 のローカル VS Code、開発用 Node.js は22以降を前提とします。Extension Host は VS Code 内の Node.js で動作します。Storybook は UI の確認用で、Extension Host や実際の Codex App Server 接続の検証とは分けます。

## 実行コマンド

### pnpm

ルートで `pnpm watch`、`pnpm check`（Lint・型チェック）、`pnpm test`（製品経路のローカル検証）を実行できます。`pnpm test:distribution` は展開 VSIX と実 Extension Host の検証です。`pnpm compile` は開発ビルド、`pnpm package` は本番ビルドです。検証は変更の影響に合わせて選び、UI の検証は該当ガイドに従います。Windows で PowerShell の実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。

> **未解決のため実行できません。** この例は未決の検証Skillに属します。ユーザーへ未解決と伝えて停止してください。コマンド・ラベルは原文のまま保持します。

# ノートを作成する

ノート作成では、ブラウザーやCLIから題名付きのノートを保存し、未完成の下書きを取り消し、別の利用者向け画面で保存結果を確認できる。

## Sub-features

- `create-open`：各ブラウザー入口から空の編集画面を開く。
- `create-save`：題名と本文を永続化する。
- `create-cancel`：未完成のブラウザー下書きを破棄する。
- `create-cli`：端末から同じ形のノートを作成する。

## How to get to it (user POV)

- ブラウザーツールバーの`New note`ボタンを選ぶ。
- 編集可能なフィールド以外にフォーカスがあるとき、ブラウザーで`n`を押す。
- 端末で`notes create --title <title> --body <body>`を実行する。

## Driving it with control-notes

Preconditions:

- Notesが`http://127.0.0.1:4173`で正常に動作している。
- `Release checklist`という題名のノートが存在しない。
- `control-notes doctor`が期待するURLと破棄可能なデータディレクトリを報告する。

- **編集画面を開く。** `New note`を選ぶ。`control-notes browser click --role button --name "New note"`を実行する。`Note editor`という名前のフォームが現れ、`Title`テキストボックスへフォーカスが移る。
- **内容を入力する。** 題名と本文を入力する。`control-notes browser fill --role textbox --name "Title" --value "Release checklist"`と`control-notes browser fill --role textbox --name "Body" --value "Tag and publish"`を実行する。`Save note`ボタンが有効になる。
- **保存する。** `Save note`を選ぶ。`control-notes browser click --role button --name "Save note"`を実行する。`Note saved`という名前の状態が現れ、見出しは`Release checklist`となる。
- **永続化を確認する。** ノート一覧へ戻ってノートを再度開く。`control-notes browser click --role link --name "All notes"`と`control-notes browser click --role link --name "Release checklist"`を実行する。編集画面に保存した両方の値が表示される。
- **下書きを取り消す。** 新しいノートを開き、`Discard me`と入力して`Cancel`を選ぶ。`control-notes browser click --role button --name "New note"`、`control-notes browser fill --role textbox --name "Title" --value "Discard me"`、`control-notes browser click --role button --name "Cancel"`を実行する。ノート一覧へ戻り、`Discard me`へのリンクが存在しない。
- **CLIから作成する。** 2つ目のノートを作成する。`control-notes cli -- notes create --title "CLI note" --body "Created from terminal" --format json`を実行する。終了コードは`0`で、stdoutにはノートの新しいIDと題名が含まれる。
- **証拠を残す。** 両方の保存済みノートを`All notes`から開き直す。`control-notes browser snapshot --aria --path artifacts/create-note/list.aria.txt`と`control-notes browser screenshot --path artifacts/create-note/list.png`を実行する。成果物には`Release checklist`と`CLI note`が写る。

## Gotchas

- テキストボックスにフォーカスがあるときの`n`は新しい編集画面を開かず、文字を入力する。
- 保存時に題名の前後の空白は除去される。下書き入力値ではなく描画された題名を検証する。
- 保存済みの状態表示だけでは証拠として不十分。ノート一覧から再度開く。
- フィクスチャの後片付けでは`Release checklist`と`CLI note`を削除するが、証拠となる成果物は残す。

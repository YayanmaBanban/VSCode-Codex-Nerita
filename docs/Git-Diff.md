かなりユースケースあります。
ただし **`#Git Diff` を常時目立つ第一級コンテキストにするか**は微妙で、僕なら `#Changes` 系として入れます。

特に強いのは「**現在のコードそのもの**」ではなく、**何を変更したのかをLLMに理解させたい場面**です。

- **コードレビュー**
  `#GitDiff この変更に問題ある？`
  → ファイル全体ではなく変更箇所だけ見せられる。最も典型的な用途です。

- **変更内容からコミットメッセージ生成**
  `#GitDiff コミットメッセージを作って`
  → `git diff` がそのまま入力資料になります。

- **PR説明文・変更概要の生成**
  `#GitDiff 今回の変更を3点でまとめて`
  → 「現在の実装」ではなく「以前から何が変わったか」が重要。

- **バグ混入箇所の調査**
  `#GitDiff この変更でテストが落ちる原因を探して`
  → 直前まで動いていた場合、変更箇所に探索範囲を絞れます。

- **意図しない変更の検出**
  `#GitDiff 関係ない変更が混ざっていない？`
  → formatting、import整理、設定ファイル変更などをレビューしやすい。

- **テスト不足の確認**
  `#GitDiff この変更に対して追加すべきテストは？`
  → 変更されたAPIや分岐だけから必要なテストを提案できます。

- **ドキュメント更新漏れ**
  `#GitDiff READMEや設定例の更新も必要？`

ここで重要なのが、`#File` と役割がかなり違うことです。

```text
#File
「今どうなっているか」

#Symbol
「この関数/クラスはどうなっているか」

#GitDiff
「何が変わったか」
```

なのでContext Pickerとしては意味が被りません。

### むしろ `Git Diff` 1個より3種類ほしい

実装するなら個人的には、

```text
#Changes
├─ Working Changes
├─ Staged Changes
└─ Branch Changes
```

くらいが使いやすいです。

たとえば、

```text
#WorkingChanges
git diff
```

は未ステージ変更。

```text
#StagedChanges
git diff --cached
```

はコミット予定の変更。

そして一番強いのが、

```text
#BranchChanges
git diff main...HEAD
```

のような **「このブランチ全体で何を変更したか」** です。

これはPRレビューとの相性が非常に良いです。

### 今のUIなら `#Git Diff` より `#Changes` が自然

ユーザー目線ではGitコマンドを意識させず、

```text
#
├─ File
├─ Folder
├─ Symbol
├─ Selection
├─ Thread
├─ Terminal
└─ Changes
```

にして、`Changes` を開くと

```text
Changes
├─ Uncommitted
├─ Staged
├─ Since last commit
└─ Current branch vs main
```

と出す方が分かりやすいと思います。

さらに表示時に、

```text
Current branch vs main
12 files · +183 -74
```

くらい出せると選びやすいです。

### additionalContextとの相性も良い

例えば内部では、

```ts
additionalContext: {
  "git:working-tree": {
    kind: "application",
    value: diffText
  }
}
```

にできます。

ただしdiffは巨大化しやすいので、ここだけは上限を設けた方がいいです。

```text
binary file     → 除外
lock file       → デフォルト除外
generated files → 除外
巨大diff        → ファイル一覧 + diff summary
```

くらいが安全です。

なので結論としては、**追加する価値はかなりあります**。特にレビュー・コミット・PR・デバッグでは `#File` より `#Changes` の方が適切なケースが多いです。

そして名前は `#GitDiff` より、ユーザー向けには **`#Changes`** を推します。内部実装だけGit Diffにしておくのが綺麗です。

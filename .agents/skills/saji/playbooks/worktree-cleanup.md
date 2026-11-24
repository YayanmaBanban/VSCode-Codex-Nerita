### worktreeとシミュレーターの整理（Worktree and simulator cleanup）

1. **状態の記録と監査。** 最初に`df -h /`を記録し、`scripts/worktree-audit.sh [-b <pr-base-ref>] [repo-path]`を実行する（**principle-build-the-lever**）。`-b`を指定しないと`origin/HEAD`を基準に`MERGED`を判定するため、PRが別ブランチを対象にしている場合は`-b origin/<branch>`を渡す。worktreeのパスは手入力せず、必ず`git worktree list`から取得する。手入力した`myrepo-worktrees/x`では、`.cursor/worktrees/myrepo/x`に存在するworktreeを見逃すためである（**principle-encode-lessons-in-structure**）。各worktreeを容量、経過時間、マージ状態、未コミットの変更、PRの状態、最後に触れたチャットから分類し、候補群を提案する。トランスクリプトの走査は遅いため、バックグラウンドで実行する。
2. **分類は助言であり、削除権限ではない。** ピン留め済み・進行中のチャットが本来の確認対象である（**principle-prove-it-works**）。該当する一覧をユーザーまたはサイドバーから入手し、全候補と照合する。監査ツールがユーザーのピン留めしたworktreeを`safe`と判定した実例があるため、ピン留め情報を優先する。
3. **削除前に利用状況を確かめる。** `verify-recent-chat`と分類された行、または疑わしい項目では、サブエージェントを並列に起動しトランスクリプトを読ませる。チャットがピン留め済みか進行中か、どのworktreeに触れたかを報告させる（トランスクリプトは大量なので**principle-guard-the-context-window**を適用）。ピン留めされたチャットから`arena`や再現用のworktreeが兄弟ディレクトリにサブエージェント経由で生成される場合があり、サイドバーに名前が出なくても使用中として扱う。Subagentsセクションに従って推論レベルを選ぶ。
4. **不可逆な消失を防ぐため停止する。** `wip:N`は追跡済みで未コミットの変更N件を表す。クリーンなworktreeはブランチから復元できるが、未コミット作業は失われるので、削除前に差分を示して判断を得る。`scratch:N`は未追跡の使い捨てファイルN件で、削除してもよい候補だがファイル名は示す。Autonomyに従い、クリーンかつマージ済み、かつ未使用なら進める。`wip`または使用中の場合は停止する。
5. **確認済みの対象を掃除する。** パスごとに`git worktree remove --force <path>`を実行する。無視対象のビルド生成物などでディレクトリが残る場合は`rm -rf`で削除し、その後`git worktree prune`を実行する。ブランチ参照は残るため、コミットは失われない。`df -h /`とworktree一覧を再取得して確認する。
6. **シミュレーターなどの容量回収。** 次に大きな削減が期待できるのは通常シミュレーター。`xcrun simctl --set testing delete all`（XCTestDevicesの複製）、`xcrun simctl delete unavailable`、`xcrun simctl runtime list`で古いランタイムを調べたうえで`runtime delete <id>`を実行する。さらに必要ならXcodeの`DerivedData`と`iOS DeviceSupport`、`~/Library/Application Support/Cursor`（`state.vscdb.backup`と、ワークスペースとして開いたフォルダに対応する`snapshots/roots/<root>`（`<root>`はそのフォルダ名に対応）の肥大化した部分）、パッケージキャッシュ（pnpm、uv、brew、yarn）などを対象にする。ユーザーから保持を指定されていないキャッシュだけを消去する。

このPlaybookだけは、コードレビューで誤りが検出されないままユーザーデータを削除しうる。したがって上記のゲート自体がレビューに当たる。

**回答：** `df -h /`の前後値と回収容量、削除したworktree、保留した各worktreeの一行理由（どのチャットが使用中か、未コミット作業があるか）を示す。

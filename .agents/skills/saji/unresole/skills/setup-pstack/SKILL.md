> **未解決のため実行できません。** このSkillにはCursor専用のモデル設定やPi/Codexで未確定の操作があります。実行せず、未解決であることをユーザーに伝えて停止してください。以下は原文に沿った日本語訳です。

---
name: setup-pstack
description: pstackが役割ごとに使用するモデルと推論予算を設定する。利用可能なモデルを検出し、Skillの既定値を上書きする常時適用規則を書き出す。/setup-pstack、pstackモデル設定、推論予算、モデル変更に使用する。
---

# pstackの設定（Setup pstack）

`~/.cursor/rules/pstack-models.mdc`に、役割別のモデルを指定する常時適用規則を書く。

## 工程

### 1. 利用できるモデルを検出する

このセッションで`Task`サブエージェントに渡せるモデル識別子を列挙する。これが信頼できる情報源となる。Cursorが利用権限のあるモデル一覧を返すAPIやCLIを提供している場合は、網羅性のためそちらを優先する。一つも検出できなければ、利用できる識別子をユーザーに貼り付けてもらう。利用可能と確認できない実モデルの識別子を絶対に書かない。`inherit-parent`と`auto`は検出された識別子ではなくても常に有効なエイリアスである。

### 2. 現在の状態を読み込む

既定の役割からモデルへの対応は手順5の規則に示す形式である。`~/.cursor/rules/pstack-models.mdc`がすでにある場合は読み、`# budget`行と役割ごとの値を現在の選択として扱う。なければ既定値から始める。手順5にない役割、例えば`hardest tasks`、`architect runners`、`reflect tooling`、`why investigators`は廃止された役割なので削除する。

以前の既定値では、パネルの担当枠に別のGeminiモデル、その後`gemini-4-neon-high`を使用していた。このため、パネルの役割（`arena runners`、`arena cross-judge pool`、`interrogate reviewers`）で`gemini-4-neon-high`、または`gemini-4-neon-*`以外の`gemini-4-*`があれば、以前の既定値である。その値をそれぞれ`gemini-4-neon-xhigh`に変更する。ほかの推論レベルのGemini 4 Neonはユーザーの選択なので維持する。置き換えた項目をユーザーへ伝える。

`# defaults: 3`行のない規則は古い設定方法による。その方法はすべての役割行を書いていたため、一部はユーザーの選択でなく古い既定値である。手順3の前に次の値を置き換える。

- `arena cross-judge pool`が、`claude-fable-*`、`claude-opus-*`、`gemini-*`を1件ずつ含むちょうど3件の一覧なら、順序にかかわらず手順5の一覧を使う。FableとOpusは同じベンダーなので、Fableの審査担当が利用できるのはOpusと同じ場合だけだからである。
- `# budget: unlimited`は`large`に変更する。どの役割も`xhigh`を超えないためである。
- `# defaults: 2`行もない場合、`grok-*`に一致する識別子は古い識別子である。`feature, refactoring`、`bug-fix`、`perf-issue`、`hillclimb`、`swarm workers`にある古い識別子は、手順5のその役割の既定値に置き換える。パネル役割（`arena runners`、`arena cross-judge pool`、`interrogate reviewers`）で`claude-opus-*`と古い識別子を1件ずつ含む2件の一覧は、順序にかかわらずその役割の手順5の一覧を使う。ほかの一覧にある古い識別子は、それぞれ`claude-opus-5-5-high-fast`に変更する。

それ以外の値はすべてユーザーの選択として残す。ほかの役割にある古い識別子と、すべての`inherit-parent`・`auto`も含む。置き換えた値をユーザーへ伝える。

### 3. 予算を設定し、対応付けて、確認する

**(a) 予算を尋ねる。** 自由入力より`AskQuestion`を優先する。次の3つを**正確にこのラベルで**提示し、規則に記録がある場合は現在の予算も示す。規則がない場合は`large`がSkillの既定値に相当すると伝える。

- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) 予算を適用する。** Skill既定値から作業用の表を作り、再実行ではモデル系列、一覧、エイリアス（`inherit-parent`、`auto`）を変更した役割の選択を保持する。モデル系列は**arena** SkillのフェーズAで定義され、Fableは独自の系列である。各役割は、既定の推論レベルを予算に応じて変更した目標レベルを持つ。`large`は維持、`medium`は1段階下げ、`small`は2段階下げる。段階は`xhigh` ＞ `high` ＞ `medium` ＞ `low`。どの役割も`xhigh`を超えず、最下位まで下げたらそこに留まる。大半の既定値は`xhigh`で、各予算ラベルはそれらの到達レベルを表している。パネルの各項目も含め、役割内の実在する識別子の推論レベル部分を目標に設定する。推論レベルは末尾のトークン、または末尾に`fast`がある場合はその一つ前のトークンである。得られた識別子が検出済みでなければ、同じモデル系列で検出された識別子のうち、目標以下の最も高いレベルを用いる。それもなければ選択が必要な役割として印を付ける。`inherit-parent`と`auto`は変更しない。例えば`medium`は`claude-opus-5-5-xhigh-fast`を`claude-opus-5-5-high-fast`へ、`claude-opus-5-5-high-fast`を`claude-opus-5-5-medium-fast`へ変更する。`small`ではそれぞれ`claude-opus-5-5-medium-fast`と`claude-opus-5-5-low-fast`になる。Opus 5.5は常に`-fast`付きの識別子を使うため、すべてのOpus 5.5の値は`-fast`で終わる。Fable 5.2とGeminiにはfast版がないので、決して指定しない。Gemini 4 Neonは`low`から`xhigh`までで、`max`や`fast`はない。したがって最上位は`gemini-4-neon-xhigh`である。パネル内のGemini 4 Neonは独自の目標（`xhigh`を予算で調整した値）を使い、`large`なら`gemini-4-neon-xhigh`、`medium`なら`gemini-4-neon-high`、`small`なら`gemini-4-neon-medium`を設定する。

**(c) 役割を提示して確認する。** すべての役割とモデルを示し、検出された一覧にない実在の識別子は選択が必要だと印を付ける。手順2で削除したすべての行も挙げる。そのまま承認するか、特定の役割を変更するかを尋ねる。選択肢には、検出されたモデルの`xhigh`以下の識別子と、`inherit-parent`・`auto`（いずれも親チャットのモデルで実行することを意味し、Autoを利用するユーザーはAutoを維持できる）を含める。自由入力より`AskQuestion`を優先する。パネル役割（`arena runners`、`interrogate reviewers`）の値は一覧で、エイリアスの項目も含め各要素につきサブエージェントを1人起動するため、要素数が起動数になる。`arena cross-judge pool`も一覧だが、Arenaが起動するJudgeは1人。親と異なるベンダーの値だけを一覧順で試すため、希望する順序で記載する。Fableとその他のClaudeモデルは同一ベンダー。`inherit-parent`・`auto`の項目は決してJudgeにしない。`swarm workers`は、競争・比較で担当ごとに別モデルを指定しない限り、すべてのワーカーの既定値である。

### 4. 検証する

書き出す実在のモデル識別子は、すべて検出済みの集合に含まれ、推論レベルが`xhigh`以下でなければならない。`inherit-parent`と`auto`は常に合格とする。選択した実識別子が利用できなければ、停止して再度ユーザーに尋ねる。

### 5. 規則を書き出す

`~/.cursor/rules/pstack-models.mdc`へ、`alwaysApply: true`、`# defaults: 3`行、選んだ予算ラベルとそのレベルを示す`# budget`行、poteto-modeが使用するのと同じラベルで役割ごとに1行を書き出す。再実行しても冪等になるようファイル全体を上書きする。形式は次のとおり。

```
---
description: pstack per-role model choices (overrides skill defaults)
alwaysApply: true
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model` and spawn `generalPurpose`). Alias entries in a panel list still count toward its fan-out.
# defaults: 3
# budget: large (xhigh)
feature, refactoring: claude-opus-5-5-xhigh-fast
bug-fix: claude-opus-5-5-xhigh-fast
perf-issue: claude-opus-5-5-xhigh-fast
hillclimb: claude-opus-5-5-xhigh-fast
judgment and prose: claude-opus-5-5-xhigh-fast
arena runners: claude-fable-5-2-high, claude-opus-5-5-high-fast, gemini-4-neon-xhigh
arena cross-judge pool: claude-opus-5-5-high-fast, gemini-4-neon-xhigh
swarm workers: claude-opus-5-5-high-fast
interrogate reviewers: claude-fable-5-2-high, claude-opus-5-5-high-fast, gemini-4-neon-xhigh
```

### 6. 確認する

規則を書き出し、新しいセッションに適用されることをユーザーへ伝える。このSkillを再実行すると規則を更新できる。

### 7. 検証Skillの提案（任意）

プロジェクトに実アプリを操作して動作を証明する手段（`verify-*` Skillまたは既存ハーネス）があるか調べる。なければ一度だけ次の提案をする。「利用者と同じようにアプリを操作し、変更が動くことを証明できるプロジェクト専用の検証Skillを作りますか？ `/create-verification-skill`で生成できます」。承認された場合は`/create-verification-skill`を実行する（ワークスペース・ユーザー・プラグインのいずれか、pstackがインストールされている場所から解決する）。断られた場合は強く勧めず先へ進む。

### 8. 形式検証Skillの提案（任意）

プロジェクトに、コードに対してモデルチェッカー、証明、その他の形式的な検証器を実行するSkillがあるか調べる。なければ一度だけ次の提案をする。「テストで到達したケースだけでなく、対象範囲のすべてのケースでコードの重要な性質が成り立つことを証明できる形式検証Skillを作りますか？ `/create-formal-verification-skill`で生成できます」。承認された場合は`/create-formal-verification-skill`を実行する（ワークスペース・ユーザー・プラグインのどこにあっても解決する）。断られた場合は強く勧めず先へ進む。

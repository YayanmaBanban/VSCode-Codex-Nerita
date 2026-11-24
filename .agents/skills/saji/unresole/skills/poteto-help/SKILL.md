> **未解決のため実行できません。** このSkillはpstack/Cursor固有のセットアップとルーティングを前提としており、sajiからの利用方法が未確定です。実行を開始せず、ユーザーに未解決であることを伝えて停止してください。以下は原文に沿った日本語訳です。

---
name: poteto-help
description: pstackのセットアップ、/poteto-modeの使い方、タスクに合うSkill・Playbook・Principleの選択を案内する。質問を添えて/poteto-helpを実行する。
disable-model-invocation: true
---

# Poteto help

ユーザーのpstackに関する質問に答え、実際に送信できる依頼文を渡し、根拠となったファイルへのリンクを付ける。使い方の質問だけなら作業を開始しない。ユーザーが尋ねたのは方法であり、pstackの実行はトークンを消費するため、ユーザー自身が依頼文を送るようにする。

「pstackでこのバグを直して」など作業の実施を求めるメッセージは、使い方の質問ではない。[`poteto-mode`](../poteto-mode/SKILL.md)を読み、それに従って作業を実施する。その際Custom Modeなら常時適用されることを一度だけ説明する。

このファイルは質問と、回答を保持するSkill・Guideの対応表である。詳しい内容を管理するのはリンク先の文書である。引用する前にその文書を読み、この対応表と内容が違えばリンク先を優先する。ここでのリンクはインストール済みプラグイン内を指し、ユーザーが開けない場合がある。そのためユーザーには、公開版のファイルURLとして`https://github.com/cursor/plugins/blob/main/pstack/`の後に対象パスを付けて提示する。

## 必要なことを特定する

メッセージと会話から必要なことを推測する。「PRをレビューするSkillはどれ？」のように状況が明示されていれば、直接対応する節に進む。まだ不明なら、次の選択肢で1つの複数選択式質問を行い、選択された節だけを説明する。

- 利用開始の準備をする
- `/poteto-mode`でタスクを開始する
- 状況に合うSkillを選ぶ
- 失敗した実行を修正する
- pstackを自分向けにする

回答を変える状態を調べ、実際に違いを生む場合だけ述べる。

- `~/.cursor/rules/pstack-models.mdc`がない場合、このユーザーは`/setup-pstack`を実行しておらず、すべての役割が既定モデルを使う。
- プロジェクトに`verify-*` Skillなどのアプリ操作用ハーネスがない場合、エージェントは実アプリを操作するスクリプトを持たない。変更が動くことの証明を尋ねられたら`/create-verification-skill`を案内する。
- 形式検証Skillがない場合、テストが届く範囲の外側の性質は検証されていない。競合、不変条件、その他テストで届きにくい問題について質問されたら`/create-formal-verification-skill`を案内する。形式検証Skillがあり、最後の同期コミットより後で対象コードが変わっているなら、そのコードに関する質問では`/maintain-formal-verification-skill`を案内する。

モデルの規則が存在せず、そのことが回答に影響する場合、役割ごとのモデルと推論予算を今選ぶか尋ねる。新しいユーザー、セットアップや費用についての質問、どのモデルが動くかで答えが変わる場合が該当する。チャットごとに質問するのは最大1回。必要なこと自体も曖昧なら、両方の質問をまとめる。選択肢は次の2つ。

- **今：** `/setup-pstack`を入力してもらい、その質問にも回答する。
- **後で：** 質問だけに回答し、`/setup-pstack`を実行するまで各役割は既定モデルを使うと1行で伝える。

## 利用開始の準備（Get set up）

1. チャットで`/add-plugin pstack`を使用するか、サイドバーのCustomizeからインストールする。
2. [`/setup-pstack`](../setup-pstack/SKILL.md)を実行する。推論予算を尋ね、各役割へモデルを割り当て、規則を書き出す。規則は新しいチャットに適用される。次に、既存のものがない場合は検証Skillと形式検証Skillの生成をそれぞれ一度ずつ提案する。
3. 目標と合否判定できる完了条件を付け、`/poteto-mode`で実際のタスクを開始する。

インストールしただけではSkillが呼び出されるまで何も変わらない。`/setup-pstack`だけはユーザーの言葉から読み込まれる。詳細は[README](../../README.md)と[Guide第1章](../../docs/guide/01-setup.md)にある。[`references/prompting.md`](references/prompting.md)に従い、最初の依頼文を一緒に作ることを提案する。

費用が心配なら、どこでトークンを使い、どう削減できるか伝える。pstackはサブエージェントとレビューパネルで追加トークンを使う。`/setup-pstack`を再実行し、予算を小さくするか低コストのモデルを選ぶ。`auto`または`inherit-parent`に設定した役割はチャットのモデルで実行され、チャットがAutoや安価なモデルならトークン消費を減らせる。パネルの一覧を短くすると、項目数に対応して起動するサブエージェント数が減る。厳密さが必要な作業に`/poteto-mode`を使う。

pstackはCursor向けに作られている。Claude Codeにも`/plugin marketplace add cursor/plugins`、次に`/plugin install pstack@cursor-plugins`で導入できる。その場合は`/pstack:poteto-mode`のようにコマンドへ`pstack:`接頭辞が付く。[Claude Codeアダプター](../../docs/harness/claude-code.md)がCursor名を対応付け、BugbotやAutomationsなどCursor専用機能が必要な工程は1行の説明付きで省略される。

ほかのツールもAgent Skills形式のためSkillを読むことはできる。ただし`/poteto-mode`、`/how`、`/teach`を含む多くのワークフローSkillはCursorのサブエージェントを起動し、一部は役割別モデルを指定する。またCustom Modesと`/loop`はCursor固有の機能なので、ほかのツールでその部分が動くとは限らない。

## `/poteto-mode`でタスクを始める

`/poteto-mode`はタスクに合うPlaybookを選び、各工程をToDoへ転記し、必要になったSkillを呼び出す。よい依頼文には目標と、完了をどう判定するかを書く。Skillを列挙しない。独自の手順列はPlaybookが持つ工程を落としたり、順番を変えたりしやすいためである。依頼文を作る前に[`references/prompting.md`](references/prompting.md)を読む。[Guide第2章](../../docs/guide/02-poteto-mode.md)には例がある。

`/poteto-mode`が継続するかは開始方法による。

- `/poteto-mode`でEnterを押すと、一つのメッセージにSkillが添付される。会話が続くにつれ効果は薄れる。
- MacのOption+Enter、WindowsのAlt+Enter、またはSkillの項目でUse as Modeを選ぶとCustom Modeになる。解除するまで毎ターンの文脈に残り、通常の雑談には適用されない。
- Cursorの文書ではAgents WindowとCLIにCustom Modesが記載されている。そのほかの場所では新しいタスクごとに`/poteto-mode`を使う。

この話題では[CursorのSkill文書](https://cursor.com/docs/skills)へリンクする。会話の途中で「new task」と言うと新しいPlaybookを選び直す。`/poteto-mode`はPlaybook内で起動するサブエージェントにすでに`poteto-agent`を使う。自分で起動するサブエージェントにも同じスタイルを使うなら`subagent_type: "poteto-agent"`を指定する。

## Skillを選ぶ

既定の回答は`/poteto-mode`。工程が必要とする多くのSkillを呼び出す。Playbookより何かを強めたり弱めたりしたい場合はSkillを直接指定する。推薦前にSkillを読み、依頼文の例を一つ示す。

| ユーザーがしたいこと | Skill |
| --- | --- |
| 複雑なタスクを厳密に進める | [`/poteto-mode`](../poteto-mode/SKILL.md) |
| 開始前にエージェントが目標と問題を理解したか確かめる | [`/in-your-own-words`](../in-your-own-words/SKILL.md) |
| タスクを広げず深めた依頼文に書き換える。一流の専門家が追加する点、生資料、方法、外部の合否判定を含める。作業は実行せず依頼文だけ返す | [`/sharpen`](../sharpen/SKILL.md) |
| 作成対象の専門用語と近接分野の用語を学び、出典を確認し、説明文を書き換える | [`/reframe`](../reframe/SKILL.md) |
| 現在のコードの仕組み、コードを置く場所を知る | [`/how`](../how/SKILL.md) |
| コードがその構造になった理由、数値の根拠を知る | [`/why`](../why/SKILL.md) |
| 変更やサブシステムを平易な説明で理解する | [`/teach`](../teach/SKILL.md) |
| 自分の最近の特定テーマの作業状況を知る | [`/recall`](../recall/SKILL.md) |
| 最後の自分の発言からこのチャットで何が変わったかを、小さな図と平易な言葉で知る。判断待ちのすべての項目を回答だけで判断できるようにする | [`/ketchup`](../ketchup/SKILL.md) |
| 同じ振り返りを短い字幕付きスライド動画で見て、判断待ちの内容を下の文章で読む | [`/ketchup-video`](../ketchup-video/SKILL.md) |
| 小さな差分が範囲外の何を壊すか知る | [`/blast-radius`](../blast-radius/SKILL.md) |
| 関数境界をまたぐコードを書く前に型とモジュール構造を決める | [`/architect`](../architect/SKILL.md) |
| 同じ依頼への複数案を得て、優れた部分を統合する | [`/arena`](../arena/SKILL.md) |
| 作業範囲を並列で確認するか、クラウドワーカーを競争させる | [`/swarm`](../swarm/SKILL.md) |
| 異なるモデルで差分をレビューし、問題を探す | [`/interrogate`](../interrogate/SKILL.md) |
| 安価なローカルテストがあるバグをテスト先行で直す | [`/tdd`](../tdd/SKILL.md) |
| `.ts`や`.tsx`の作業にTypeScript規則を適用する | [`/typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| コードを書いていないレビューワーでコメントを確認し、レビュー前に整理する | [`/no-comments`](../no-comments/SKILL.md) |
| AI特有の文章表現を除去する | [`/unslop`](../unslop/SKILL.md) |
| 文書、RFC、README、PR説明、コミットメッセージを規範に沿って書く | [`/technical-writing`](../technical-writing/SKILL.md) |
| 直前の返答を普通の言葉で言い直す | [`/bro`](../bro/SKILL.md) |
| エージェントに実アプリを操作させ、動作を証明する仕組みを与える | [`/create-verification-skill`](../create-verification-skill/SKILL.md) |
| 検証Skillと機能一覧をアプリの現在状態へ合わせる | [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| テストが届きにくい競合や不変条件などを形式検証する | [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| コード変更後の形式検証を更新し、失敗がずれか不具合か判定する | [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| PMやデザイナーへ、TLA+で確認した状態図と規則違反までの最短経路を示す | [`/statechart`](../statechart/SKILL.md) |
| 性能の数値を報告・採用する前に検証する | [`/benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| 大規模・横断的な変更や、離席後にレビューする作業を実行する | [`/figure-it-out`](../figure-it-out/SKILL.md) |
| 作業中の意思決定を記録し、後からレビューする | [`/show-me-your-work`](../show-me-your-work/SKILL.md) |
| 役割ごとのモデルと推論予算を選ぶ | [`/setup-pstack`](../setup-pstack/SKILL.md) |
| 自分の仕事のやり方を個人用Mode Skillへする | [`/automate-me`](../automate-me/SKILL.md) |
| 終了したタスクから学んだことをSkill修正へ変える | [`/reflect`](../reflect/SKILL.md) |
| リポジトリでエージェントの同じ誤りを繰り返させない | [`/correct`](../correct/SKILL.md) |
| ボタンからWebhookでGrok Botを起動するページを作る | [`/make-bot-ui`](../make-bot-ui/SKILL.md) |
| pstackの使い方を案内してもらう | `/poteto-help` |

このファイルと同じ階層にあるSkillディレクトリが表から漏れている場合は、frontmatterを読み、descriptionで振り分ける。`principle-*`ディレクトリは以下のPrincipleの節で扱う。

迷いやすい組み合わせ。

- `/how`はコードが何をするか、`/why`はその理由を説明する。`/teach`は片方または両方を実行し、平易に説明する。
- `/arena`は全ワーカーへ同じ依頼を渡して優れた部分を統合する。`/swarm`は仕事を部分ごとに分けるか競争させ、報告を一つにする。
- `/interrogate`は差分をレビューし、`/blast-radius`は差分の外の不具合を探し、安全性を左右する一つの事実を証明する。
- `/recall`は最近の複数チャットから文脈を復元し、`/ketchup`はユーザーの最後の発言以降のこのチャットだけを対象とする。特定の一つのチャットやブランチの再開はSession pickup Playbook。
- `/figure-it-out`は厳密な一つの実行を設計し、Autonomous run Playbookは一つのタスクを終了条件まで進める。

pstackに含まれないもの。

- `/deslop`、`control-cli`、`control-ui`は`cursor-team-kit`プラグインにある。
- `/loop`と`/create-skill`はCursor組み込みである。
- pstackには`/orchestrate` Skillはない。メニューに`/orchestrate`があれば別のプラグインが提供している。

## PlaybookとPrinciple

Playbookは`/poteto-mode`内の工程一覧で、Skillではないため独自のスラッシュコマンドはない。`/poteto-mode`ではタスクの説明から選ばれるが、次の言葉で直接指定できる。

- 「babysit this pr」「check on pr 123」はBabysitを実行する。PRをマージ可能な状態へ進めて停止する。ユーザーがmerge・land・shipを依頼しない限りマージしない。
- 「land the stack」はShippingを実行する。
- 「take over this branch」はSession pickupを実行する。
- 「pause safely」はPause safelyを実行する。
- 「full autopilot on this queue」はAutopilot-fullを実行する。「autopilot, don't merge」はAutopilot-stackを実行する。
- 「run the eval playbook」はEvalを実行する。

`/poteto-mode`がない場合、「babysit this pr」のような言葉は同じ仕事をするCursor組み込みのSkillを起動してしまう場合がある。[`poteto-mode`](../poteto-mode/SKILL.md)のPlaybooks節にすべての一覧がある。[Guide第6章](../../docs/guide/06-verify-and-ship.md)ではPRの作成、監視、マージを説明している。

pstackに計画Skillはない。CursorのPlan Modeを併用できる。フェーズやPRスタックにまたがる作業で`/poteto-mode`に計画を求めると、[Multi-phase plan Playbook](../poteto-mode/playbooks/multi-phase-plan.md)が選ばれ、計画だけを書いて実装はしない。設計の疑問ならPrototype Playbookか`/architect`で先に実験・設計する。

Principleは`/poteto-mode`が読み、回答で適用を示す一規則ずつのSkillである。ユーザーが直接呼び出すことはまれで、たとえば「apply prove it works. show me the real output.」のように名前で方向を示す。`/principle-<name>`と入力して個別に読み込むこともできる。[Guide第8章](../../docs/guide/08-principles.md)に一覧がある。

## 失敗した実行の修正

| 症状 | 対処 |
| --- | --- |
| 数ターン後にModeの適用が止まった | Enterで起動したため。Custom Modeで開始するか、タスクごとに`/poteto-mode`を付ける |
| 質問を前のタスクの次の工程として扱ってしまった | 「new task」と伝えるか、このターンにModeは不要だと指定する |
| 新しいモデルの選択が反映されない | `/setup-pstack`の設定は新しいチャットに適用される。新しいチャットを開始する |
| 想定よりトークンを消費する | 利用開始の準備にあるコストの節を参照 |
| Skillが自動的に読み込まれない | ユーザーの言葉から読み込まれるのは`/setup-pstack`だけ。ほかはユーザーの直接指定か`/poteto-mode`の工程から読み込まれ、すべてが起動するわけではない |
| 並列エージェントが変更を上書きし合う | 各エージェントに独立したworktreeを与えるか、それぞれ専用マシンを持つクラウドエージェントで起動する |
| 夜間の作業が進んだが何も完了しなかった | `/loop`には実行時間ではなく、合否を判定できる条件が必要。[Guide第7章](../../docs/guide/07-overnight.md)参照 |
| ビルドが成功しただけで完了と主張する | 実際のコマンド、操作フロー、保存値、プロファイルを要求する。Prove It Works Principleを適用する |

実行が逸脱する場合、[`references/prompting.md`](references/prompting.md)に短い指示例がある。[Guide第10章](../../docs/guide/10-recipes-and-pitfalls.md)には、さらに多くの失敗例と再利用できる手順がある。

## pstackを自分向けにする

- [`/automate-me`](../automate-me/SKILL.md)はユーザー自身の履歴から個人用Mode Skillを作成し、`/poteto-mode`と併用できるようにする。
- [`/reflect`](../reflect/SKILL.md)はセッション後の教訓を、ユーザー承認のSkill修正にする。
- `/poteto-mode write a skill for <workflow>`はSkill作成Playbookを実行する。Eval Playbookでは変更をブラインド評価する。
- 動作のおかしいSkillは、その問題が生じた機能変更の作業へ混ぜず、Skill単独のPRで修正する。

[Guide第9章](../../docs/guide/09-make-it-yours.md)に詳細がある。

## 回答

最初に質問への答えを述べる。適した例がある場合は[`references/recipes.md`](references/recipes.md)を基に調整した依頼文をコードブロックで最大1つだけ示し、そのファイルへのリンクを付ける。ユーザーから全体の対応表を求められていない限り短く答える。

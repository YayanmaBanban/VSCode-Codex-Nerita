# 専門Skillの選択と参照先

この一覧はpstackを基にした34個の専門Skillの参照先を示す。名称と発動条件を確認してから、対象の`SKILL.md`を最後まで読む。**`unresole/`配下のSkillは実行禁止**であり、先頭の警告に従い未解決であることをユーザーに伝えて停止する。通常のSkillについても、実在しないコマンドやエージェントを起動したと主張しない。

| Skill | 役割 | 状態・本文 |
| --- | --- | --- |
| `in-your-own-words` | 目標と問題の言い直し | [参照](../skills/in-your-own-words/SKILL.md) |
| `sharpen` | 依頼を広げず深める | [参照](../skills/sharpen/SKILL.md) |
| `why` | 設計・変更理由の追跡 | [参照](../skills/why/SKILL.md) |
| `unslop` | AI特有の文章表現の除去 | [参照](../skills/unslop/SKILL.md) |
| `bro` | 直前の回答を平易に言い直す | [参照](../skills/bro/SKILL.md) |
| `technical-writing` | 技術文書の規則 | [参照](../skills/technical-writing/SKILL.md) |
| `tdd` | 低コストな回帰テストを先に書く | [参照](../skills/tdd/SKILL.md) |
| `architect` | 関数境界・型・モジュールの設計 | [未解決・実行禁止](../unresole/skills/architect/SKILL.md) |
| `arena` | 同じ課題の複数案を競争・統合 | [未解決・実行禁止](../unresole/skills/arena/SKILL.md) |
| `swarm` | 複数の作業範囲の並列実行と集約 | [未解決・実行禁止](../unresole/skills/swarm/SKILL.md) |
| `interrogate` | 異なるモデルによる実証付き批判的レビュー | [未解決・実行禁止](../unresole/skills/interrogate/SKILL.md) |
| `figure-it-out` | 既存Playbookにない大規模作業の工程設計 | [未解決・実行禁止](../unresole/skills/figure-it-out/SKILL.md) |
| `benchmark-checklist` | 性能数値の実測・健全性確認 | [未解決・実行禁止](../unresole/skills/benchmark-checklist/SKILL.md) |
| `no-comments` | Comment Sickoによるコメントレビュー | [未解決・実行禁止](../unresole/skills/no-comments/SKILL.md) |
| `typescript-best-practices` | TypeScriptの型・構造規律 | [未解決・実行禁止](../unresole/skills/typescript-best-practices/SKILL.md) |
| `correct` | 繰り返すエージェントの失敗を構造で抑止 | [未解決・実行禁止](../unresole/skills/correct/SKILL.md) |
| `reflect` | 実行履歴からSkillの改善案を作成 | [未解決・実行禁止](../unresole/skills/reflect/SKILL.md) |
| `blast-radius` | 差分外の影響範囲を実証 | [未解決・実行禁止](../unresole/skills/blast-radius/SKILL.md) |
| `reframe` | 専門用語から問題を捉え直す | [未解決・実行禁止](../unresole/skills/reframe/SKILL.md) |
| `how` | 実装の仕組みを読み取り専用で調査 | [未解決・実行禁止](../unresole/skills/how/SKILL.md) |
| `recall` | 最近の複数チャットから作業文脈を復元 | [未解決・実行禁止](../unresole/skills/recall/SKILL.md) |
| `ketchup` | 最後のユーザー発言以降の状況整理 | [未解決・実行禁止](../unresole/skills/ketchup/SKILL.md) |
| `ketchup-video` | 状況整理を字幕付き動画にする | [未解決・実行禁止](../unresole/skills/ketchup-video/SKILL.md) |
| `setup-pstack` | 役割・モデル・推論予算の設定 | [未解決・実行禁止](../unresole/skills/setup-pstack/SKILL.md) |
| `automate-me` | 個人の作業習慣を-mode Skillにする | [未解決・実行禁止](../unresole/skills/automate-me/SKILL.md) |
| `make-bot-ui` | Webhookを起動するBot用UI | [未解決・実行禁止](../unresole/skills/make-bot-ui/SKILL.md) |
| `teach` | how/whyによる段階的な技術解説 | [未解決・実行禁止](../unresole/skills/teach/SKILL.md) |
| `show-me-your-work` | 意思決定のTSV記録とモデル間監査 | [未解決・実行禁止](../unresole/skills/show-me-your-work/SKILL.md) |
| `create-verification-skill` | アプリを実操作する検証Skillの生成 | [未解決・実行禁止](../unresole/skills/create-verification-skill/SKILL.md) |
| `maintain-verification-skill` | 検証Skillの機能一覧・実動作の保守 | [未解決・実行禁止](../unresole/skills/maintain-verification-skill/SKILL.md) |
| `create-formal-verification-skill` | 形式検証Skillを生成 | [未解決・実行禁止](../unresole/skills/create-formal-verification-skill/SKILL.md) |
| `maintain-formal-verification-skill` | 形式検証を実コードに同期 | [未解決・実行禁止](../unresole/skills/maintain-formal-verification-skill/SKILL.md) |
| `statechart` | TLA+とTLCによる状態図と反例 | [未解決・実行禁止](../unresole/skills/statechart/SKILL.md) |
| `poteto-help` | pstackの使い方案内 | [未解決・実行禁止](../unresole/skills/poteto-help/SKILL.md) |

## 利用時

1. `saji/SKILL.md`またはPlaybookで要求される名前から、この一覧の本文ファイルを特定する。
2. 通常のSkillは本文の前提・工程を確認する。未解決のSkillは本文先頭の警告で停止する。
3. Skill本文にさらに別のSkillが指定される場合も、その名前をこの一覧で確認する。存在しないSkillを代用済みとして扱わない。

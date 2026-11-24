> **未解決のため実行できません。** この資料は未決のstatechart Skillに属します。ユーザーに未解決を伝えて停止してください。以下のCSSは原文のまま保持します。

# 状態図を描画する

提示する各`.mmd`ファイルはnpmパッケージ`pele@1.9.0`で描画し、SVGをユーザーへ渡す。Peleはリポジトリ外に一度だけインストールする。SVGは対応する`.mmd`と同じ場所に同じファイル名で保存する。APIは https://pele.run/api を参照する。`render`のオプションには`{ limit: 1_000_000, outputLimit: 8_000_000, maxEdges: 10_000 }`を渡す。Peleの既定値では状態500件の図に足りない場合がある。`PeleError`が発生した場合はMermaid本文とエラーを表示する。

## 色

PeleはMermaidの`theme`と`themeVariables`を無視する。`.pele`のCSS変数`--pele-*`で指定する。詳細は https://pele.run/theming にある。コマンドは`class sN teal`のようにグループごとの色クラスを各状態へ与える。規則を破る状態は`class sN breaks`または`class sN mayBreak`、バグまでの最短経路の状態は`class sN bugPath`、PROPERTYの反例で永遠に繰り返す状態は`class sN repeats`となる。Peleはこれらのクラスを状態ノードへ付与する。CSSで色を指定する。

`.mmd`には`breaks`と`mayBreak`の`classDef`行があり、どのMermaidビューアでも違反の印を表示できる。一方、グループ色・`bugPath`・`repeats`の`classDef`はない。Peleは`classDef`の色をノードの`style`属性に書き出し、通常のCSSより優先される。そのため下記の違反印の規則には`!important`を使う。これがなければダークテーマでも明るい印の色が残る。違反印は塗りと文字、`bugPath`と`repeats`は枠線を指定する。違反印をグループ色の後に記述して、その上に表示されるようにする。

色は推奨例であり、旧Skillで使った色である。各SVGの先頭の`<style>`要素に配置すると、閲覧者のライト／ダーク設定に従う。

```css
.pele {
  --pele-bg: #ffffff;
  --pele-fg: #1c1c1c;
  --pele-muted: #656565;
  --pele-line: #808080;
  --pele-surface: #fcfcfc;
  --pele-surface-alt: #f1f1f1;
  --pele-border: #c9c9c9;
}
.pele .blue rect { fill: #c3e0ff; }
.pele .orange rect { fill: #f0d3bf; }
.pele .purple rect { fill: #e3d5ff; }
.pele .yellow rect { fill: #f0dcbf; }
.pele .teal rect { fill: #bfe3df; }
.pele .tan rect { fill: #e5d9ce; }
.pele .pink rect { fill: #ffcbe6; }
.pele .breaks rect {
  fill: #ffecee !important;
  stroke: #e72e3b !important;
  stroke-width: 2.5px !important;
}
.pele .breaks text {
  fill: #cd2834 !important;
}
.pele .mayBreak rect {
  fill: #fff3e6 !important;
  stroke: #e8730c !important;
  stroke-width: 2.5px !important;
}
.pele .mayBreak text {
  fill: #b85a06 !important;
}
.pele .bugPath rect {
  stroke: #1680f3 !important;
  stroke-width: 2.5px !important;
}
.pele .repeats rect {
  stroke: #9b35d6 !important;
  stroke-width: 2.5px !important;
  stroke-dasharray: 6 3;
}
@media (prefers-color-scheme: dark) {
  .pele {
    --pele-bg: #1f1f1f;
    --pele-fg: #f5f5f5;
    --pele-muted: #acacac;
    --pele-line: #939393;
    --pele-surface: #121212;
    --pele-surface-alt: #2c2c2c;
    --pele-border: #4e4e4e;
  }
  .pele .blue rect { fill: #1b3857; }
  .pele .orange rect { fill: #573117; }
  .pele .purple rect { fill: #3c2e57; }
  .pele .yellow rect { fill: #573d17; }
  .pele .teal rect { fill: #174641; }
  .pele .tan rect { fill: #3d3127; }
  .pele .pink rect { fill: #57233e; }
  .pele .breaks rect {
    fill: #2e2021 !important;
    stroke: #cf2b35 !important;
  }
  .pele .breaks text {
    fill: #ff6463 !important;
  }
  .pele .mayBreak rect {
    fill: #2e2619 !important;
    stroke: #d0700f !important;
  }
  .pele .mayBreak text {
    fill: #ffa257 !important;
  }
  .pele .bugPath rect {
    stroke: #116dd2 !important;
  }
  .pele .repeats rect {
    stroke: #9a3fcf !important;
  }
}
```

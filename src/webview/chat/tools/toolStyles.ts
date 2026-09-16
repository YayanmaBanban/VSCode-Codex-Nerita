// ツール本文と差分表示で共有する文字組みを、静的な Tailwind クラスで定義する。

/** 本文と差分のどちらにも使う等幅フォント・余白。 */
export const toolCodeClass =
	"my-[6px] mx-0 font-editor text-[12px] leading-[1.6]";

/** 通常のツール出力は長い文字列もカード幅で折り返す。 */
export const toolOutputClass = `${toolCodeClass} whitespace-pre-wrap [overflow-wrap:anywhere]`;

/** 見出しとファイルパスの文字サイズ・余白を揃える。 */
export const toolLabelClass =
	"my-[8px] mx-0 text-[12px] [overflow-wrap:anywhere]";

/** 差分行の背景を横スクロール先まで伸ばす。 */
export const diffLineClass =
	"file-diff-line block min-w-full w-max px-[8px] box-border";

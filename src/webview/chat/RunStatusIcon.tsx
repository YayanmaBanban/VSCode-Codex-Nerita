// 実行状態に対応する同梱の猫SVGを、テーマ色で表示する。
import writing from "../../../media/icons/cat-writing-glasses-48.svg?raw";
import loaf from "../../../media/icons/cat-loaf-glasses-48.svg?raw";
import startled from "../../../media/icons/cat-writing-startled-48-fixed.svg?raw";
import "./thinkingIndicator.css";
import "./catLoaf.css";
import "./catStartled.css";

// CSPに従い、SVG内のスタイルを除いて外部CSSから動きを適用する。
const icons = {
	writing: writing.replace(/<style>[\s\S]*?<\/style>/, ""),
	loaf: loaf.replace(/<style>[\s\S]*?<\/style>/, ""),
	startled: startled.replace(/<style>[\s\S]*?<\/style>/, ""),
};

/** 状態の読み上げは隣の文言に任せ、アイコンを装飾として表示する。 */
export function RunStatusIcon({ kind }: { kind: keyof typeof icons }) {
	return (
		<span
			className="run-status-icon block size-12 shrink-0 [&>svg]:size-full"
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: icons[kind] }}
		/>
	);
}

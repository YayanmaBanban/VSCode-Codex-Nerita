// 思考中の光沢付き文言と、筆記する猫を横並びに表示する。
import { useReducedMotion } from "motion/react";
import { ShinyText } from "../ui/ShinyText";
import { RunStatusIcon } from "./RunStatusIcon";

/** 状態名を読み上げ、装飾の動きはOSの設定に合わせる。 */
export function ThinkingIndicator() {
	const reducedMotion = useReducedMotion();
	return (
		<div
			className="my-2 flex items-center gap-1 text-[12px] text-muted"
			role="status"
			aria-label="思考中..."
		>
			<ShinyText
				text="思考中..."
				disabled={reducedMotion === true}
				color="var(--vscode-descriptionForeground, #7d8791)"
				shineColor="var(--vscode-foreground, light-dark(#242e36, #dfe4e9))"
			/>
			<RunStatusIcon kind="writing" />
		</div>
	);
}

// 未保存の設定を保存ボタンの枠で知らせる。
import { BorderBeam } from "../../ui/BorderBeam";
import { useReducedMotion } from "motion/react";
import { buttonStyle } from "./GuardrailsRules";
/** 動きを減らす設定では枠を静止させる。 */
export function GuardrailsSaveButton({
	dirty,
	busy,
	onSave,
}: {
	dirty: boolean;
	busy: boolean;
	onSave: () => void;
}) {
	const reducedMotion = useReducedMotion();
	return (
		<button
			className={`${buttonStyle} relative overflow-hidden`}
			aria-label="保存"
			title={dirty ? "未保存の変更があります" : "設定を保存"}
			disabled={busy}
			onClick={onSave}
		>
			保存
			{dirty && (
				<span aria-hidden="true" data-testid="unsaved-beam">
					<BorderBeam
						size={32}
						duration={4}
						borderThickness={2}
						transition={
							reducedMotion ? { duration: 0, repeat: 0 } : {}
						}
					/>
				</span>
			)}
		</button>
	);
}

// 閉じたツール本文の描画を遅延し、閉じる遷移の完了後に DOM と本文内の状態を解放する。
import { useEffect, useRef, useState, type ReactNode } from "react";

/** 開き直しで終了待ちを無効化し、動きを減らす設定では遷移を待たず本文を解放する。 */
export function ToolCardCollapse({
	open,
	id,
	className,
	children,
}: {
	open: boolean;
	id: string;
	className: string;
	children: ReactNode;
}) {
	const element = useRef<HTMLDivElement>(null);
	const [present, setPresent] = useState(open);
	if (open && !present) {
		setPresent(true);
	}
	useEffect(() => {
		if (open || !present || !element.current) {
			return;
		}
		let current = true;
		// CSS の遷移が終わるまで本文を残し、閉じる途中で高さが急に変わるのを防ぐ。
		// 遷移が取り消された場合も待機を終える。開き直した場合は本文を解放しない。
		void Promise.allSettled(
			element.current
				.getAnimations()
				.map((animation) => animation.finished),
		).then(() => {
			if (current) {
				setPresent(false);
			}
		});
		return () => {
			current = false;
		};
	}, [open, present]);

	return (
		<div
			ref={element}
			id={id}
			className={className}
			inert={!open}
			aria-hidden={!open}
		>
			<div className="min-h-0 overflow-hidden">{present && children}</div>
		</div>
	);
}

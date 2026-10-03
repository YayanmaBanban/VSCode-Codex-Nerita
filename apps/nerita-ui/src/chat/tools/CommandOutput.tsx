// Host が制限したプレビューまたは取得範囲をスクロール領域に表示する。
import { cn } from "cnfast";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { SettingsTooltip } from "../SettingsTooltip";

import { toolOutputClass } from "./toolStyles";
import "./commandOutput.css";

/** 表示中のプレビューまたは一範囲だけをコピーし、未取得の全文は読み込まない。 */
export function CommandOutput({
	text,
	copyDisabled = false,
}: {
	text: string;
	copyDisabled?: boolean;
}) {
	return (
		<div className="relative">
			<pre
				className={cn(
					toolOutputClass,
					"max-h-[400px] overflow-auto rounded-[4px] border border-solid",
					"border-panel-border p-[8px] pr-[44px]",
				)}
				tabIndex={0}
				aria-label="出力"
			>
				{text}
			</pre>
			<OutputCopyButton text={text} disabled={copyDisabled || !text} />
		</div>
	);
}

/** 同じ結果の連続コピーでも演出を再開し、遅い応答で最新の結果を上書きしない。 */
function useCopyFeedback(text: string) {
	const reduced = useReducedMotion();
	const button = useRef<HTMLButtonElement>(null);
	const request = useRef(0);
	const [feedback, setFeedback] = useState<{
		id: number;
		text: string;
		result: "success" | "error";
	}>();
	const current = feedback?.text === text ? feedback : undefined;
	useEffect(
		() => () => {
			request.current++;
		},
		[],
	);
	useEffect(() => {
		if (!current) {
			return;
		}
		const shake =
			current.result === "error" && !reduced
				? button.current?.animate(
						[
							{ transform: "translateX(0)" },
							{ transform: "translateX(-2px)" },
							{ transform: "translateX(2px)" },
							{ transform: "translateX(-2px)" },
							{ transform: "translateX(2px)" },
							{ transform: "translateX(0)" },
						],
						{ duration: 300, easing: "ease-out" },
					)
				: undefined;
		const timer = setTimeout(() => setFeedback(undefined), 800);
		return () => {
			clearTimeout(timer);
			shake?.cancel();
		};
	}, [current, reduced]);
	const copy = async () => {
		const id = ++request.current;
		let result: "success" | "error" = "success";
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			result = "error";
		}
		if (id === request.current) {
			setFeedback({ id, text, result });
		}
	};
	return { current, copy, button };
}

/** カーテンでコピー結果を色分けし、説明文は共通ツールチップに固定する。 */
function OutputCopyButton({
	text,
	disabled,
}: {
	text: string;
	disabled: boolean;
}) {
	const { current, copy, button } = useCopyFeedback(text);
	const resultColors = {
		success: "border-menu-check text-menu-check",
		error: "border-tool-error text-tool-error",
	};
	return (
		<SettingsTooltip content="出力をコピー">
			<button
				ref={button}
				type="button"
				aria-label="出力をコピー"
				data-copy-result={current?.result}
				className={cn(
					"absolute top-[5px] right-[20px] inline-flex size-[28px] items-center",
					"justify-center rounded-[5px] border border-solid bg-transparent p-0",
					"focus-visible:outline-1 focus-visible:outline-settings-focus",
					"enabled:hover:bg-settings-hover",
					"disabled:opacity-50",
					current
						? resultColors[current.result]
						: cn(
								"border-panel-border text-muted",
								"enabled:hover:text-foreground",
							),
				)}
				disabled={disabled}
				onClick={() => void copy()}
			>
				<Copy size={14} aria-hidden="true" />
				{current && (
					<span
						className={cn(
							"pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
						)}
						aria-hidden="true"
					>
						<span
							key={current.id}
							className={cn(
								"output-copy-curtain absolute inset-0",
								current.result === "success"
									? "bg-menu-check"
									: "bg-tool-error",
							)}
						/>
					</span>
				)}
			</button>
		</SettingsTooltip>
	);
}

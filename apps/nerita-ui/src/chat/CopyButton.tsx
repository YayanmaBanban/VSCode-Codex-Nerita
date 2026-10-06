// 本文のコピーと、結果を示すカーテン・シェイクを共通化する。
import { cn } from "cnfast";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { SettingsTooltip } from "./SettingsTooltip";

import "./copyButton.css";

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
			current.result === "error" && !(reduced === true)
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

/** 渡された本文をコピーする。呼び出し側は説明文と配置・寸法を指定する。 */
export function CopyButton({
	text,
	label,
	disabled = false,
	className,
	iconSize = 14,
}: {
	text: string;
	label: string;
	disabled?: boolean;
	className?: string;
	iconSize?: number;
}) {
	const { current, copy, button } = useCopyFeedback(text);
	const resultColors = {
		success: "border-menu-check text-menu-check",
		error: "border-tool-error text-tool-error",
	};
	return (
		<SettingsTooltip content={label}>
			<button
				ref={button}
				type="button"
				aria-label={label}
				data-copy-result={current?.result}
				className={cn(
					"relative inline-flex items-center",
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
					className,
				)}
				disabled={disabled || text === ""}
				onClick={() => void copy()}
			>
				<Copy size={iconSize} aria-hidden="true" />
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
								"copy-curtain absolute inset-0",
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

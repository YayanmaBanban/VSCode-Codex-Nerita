// 説明と操作ボタンを持つ固定通知の見た目を共有する。
import { cn } from "cnfast";
import { Info } from "lucide-react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { ButtonCurtain } from "./ButtonCurtain";

/** 認証や信頼の判断は利用側が担当し、ボタンの表示名とクリック時の処理を渡す。 */
type NoticeAction = { id: string; name: string; onClick: () => void };
/** 通知とエラー表示に共通する枠・色・余白。 */
export const noticeClass =
	"mx-[14px] mt-[12px] mb-0 rounded-[8px] border border-solid border-alert-border bg-alert p-[12px] leading-[1.7]";
/** 操作の意味と通信は利用側が担当する。 */
export function ActionNotice({
	label,
	title,
	description,
	actions,
	className,
}: {
	label: string;
	title: string;
	description: string;
	actions: NoticeAction[];
	className?: string;
}) {
	const reducedMotion = useReducedMotion();
	const present = useIsPresent();
	return (
		<motion.section
			className={cn(noticeClass, "shrink-0", className)}
			aria-label={label}
			aria-hidden={!present}
			inert={!present}
			initial={
				reducedMotion === true
					? false
					: { opacity: 0, transform: "translateY(-20px)" }
			}
			animate={{ opacity: 1, transform: "translateY(0px)" }}
			exit={{
				opacity: 0,
				transform:
					reducedMotion === true
						? "translateY(0px)"
						: "translateY(-12px)",
				transition: {
					duration: reducedMotion === true ? 0 : 0.2,
					ease: "easeOut",
				},
			}}
			transition={{
				opacity: { duration: 0.3, ease: "easeOut" },
				transform: { duration: 0.2, ease: "easeOut" },
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div
					className={cn(
						"flex items-center gap-2 py-[4px]",
						"[.vscode-dark_&]:[color-scheme:dark]",
						"[.vscode-high-contrast_&]:[color-scheme:dark]",
						"[.vscode-high-contrast-light_&]:[color-scheme:light]",
						"[.vscode-light_&]:[color-scheme:light]",
						"[color:light-dark(var(--nerita-foreground),color-mix(in_srgb,var(--nerita-foreground)_40%,white))]",
					)}
				>
					<Info
						size={16}
						aria-hidden="true"
						className="drop-shadow-[0_0_6px_var(--nerita-focus-border)]"
					/>
					<h2
						className={cn(
							"m-0 text-4xl text-[13px] font-black font-medium",
							"[text-shadow:0_0_3px_var(--nerita-focus-border)]",
						)}
					>
						{title}
					</h2>
				</div>
				<NoticeActions actions={actions} />
			</div>
			<p className="mt-2 mb-0 pl-6 text-[12px] [overflow-wrap:anywhere]">
				{description}
			</p>
		</motion.section>
	);
}

/** 通知から実行できる操作。 */
type NoticeActionsProps = {
	actions: NoticeAction[];
};

/** 通知の操作を共通のボタンで表示する。 */
function NoticeActions({ actions }: NoticeActionsProps) {
	return (
		<div className="ml-auto flex shrink-0 items-center justify-end gap-[4px]">
			{actions.map((method) => (
				<button
					key={method.id}
					type="button"
					className={cn(
						"group relative isolate m-0 h-8 shrink-0 overflow-hidden rounded-md",
						"border px-3",
						"bg-message-user text-[12px] leading-2 font-medium",
						"[border-color:color-mix(in_srgb,var(--nerita-button-border)_75%,transparent)]",
						"transition-colors duration-100",
						"hover:[border-color:var(--nerita-focus-border)]",
						"focus-visible:ring-1 focus-visible:ring-[var(--nerita-focus-border)]",
						"focus-visible:outline-none",
					)}
					onClick={method.onClick}
				>
					{method.name}
					<ButtonCurtain name={method.name} className="bg-sky-300" />
				</button>
			))}
		</div>
	);
}

// 未認証時と認証待ちの案内・操作を共通の配置で表示する。
import { cn } from "cnfast";
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";

/** 認証状態に応じて説明と右上の操作ボタンを切り替える。 */
export function AuthenticationNotice({
	state,
	send,
	noticeClass,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
	noticeClass: string;
}) {
	const reducedMotion = useReducedMotion();
	const authenticating = state.connection === "authenticating";
	let actions = state.authMethods;
	let description =
		state.piAccount !== null
			? "Piの認証情報を設定してください。"
			: "ChatGPTにログインするか、VSCodeの起動環境に設定したAPIキーを使用します。";
	if (authenticating) {
		actions =
			state.piAccount !== null
				? [{ id: "pi-cancel", name: "認証をキャンセル" }]
				: [];
		description =
			state.piAccount !== null
				? "エディターの「Pi 認証情報」で設定してください。画面を閉じるとチャットへ戻れます。"
				: "ブラウザでログインを完了してください。最大3分間待機します。";
	}

	return (
		<motion.section
			className={cn("auth-card", noticeClass)}
			aria-label="認証"
			initial={
				reducedMotion
					? false
					: { opacity: 0, transform: "translateY(-20px)" }
			}
			animate={{ opacity: 1, transform: "translateY(0px)" }}
			transition={{
				opacity: { duration: 0.3, ease: "easeOut" },
				transform: { duration: 0.2, ease: "easeOut" },
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div
					className={cn(
						"flex items-center gap-2 py-[4px]",
						"[.vscode-dark_&]:[color-scheme:dark] [.vscode-high-contrast_&]:[color-scheme:dark]",
						"[.vscode-light_&]:[color-scheme:light] [.vscode-high-contrast-light_&]:[color-scheme:light]",
						"[color:light-dark(var(--vscode-foreground),color-mix(in_srgb,var(--vscode-foreground)_40%,white))]",
					)}
				>
					<Info
						size={16}
						aria-hidden="true"
						className="drop-shadow-[0_0_6px_var(--vscode-focusBorder,var(--vscode-textLink-foreground))]"
					/>
					<h2 className="m-0 text-[13px] font-medium text-4xl font-black [text-shadow:0_0_3px_var(--vscode-focusBorder,var(--vscode-textLink-foreground))]">
						{authenticating
							? "認証を待っています"
							: "認証が必要です"}
					</h2>
				</div>
				<div className="ml-auto flex gap-[4px] shrink-0 items-center justify-end">
					{actions.map((method) => (
						<button
							key={method.id}
							type="button"
							className={cn(
								"group relative isolate m-0 h-8 shrink-0 overflow-hidden rounded-md border px-3",
								"bg-[var(--vscode-editor-background,zinc-950)] text-[12px] font-medium leading-2",
								"[border-color:color-mix(in_srgb,var(--vscode-button-border,#414851)_75%,transparent)]",
								"transition-colors duration-100 hover:[border-color:var(--vscode-focusBorder,#007acc)]",
								"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vscode-focusBorder,#007acc)]",
							)}
							onClick={() =>
								send({
									type: "auth/start",
									requestId: crypto.randomUUID(),
									methodId: method.id,
								})
							}
						>
							{method.name}
							<span
								aria-hidden="true"
								className={cn(
									"pointer-events-none absolute inset-0 flex items-center justify-center",
									"bg-sky-300 text-black [clip-path:polygon(0_0,0_0,0_0)]",
									"transition-[clip-path] duration-300 ease-out motion-reduce:transition-none",
									"group-hover:[clip-path:polygon(0_0,200%_0,0_200%)] group-focus-visible:[clip-path:polygon(0_0,200%_0,0_200%)]",
								)}
							>
								{method.name}
							</span>
						</button>
					))}
				</div>
			</div>
			<p className="mb-0 mt-2 pl-6 text-[12px]">{description}</p>
		</motion.section>
	);
}

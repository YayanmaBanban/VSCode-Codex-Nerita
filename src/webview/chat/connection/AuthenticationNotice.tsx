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
			className={`auth-card ${noticeClass}`}
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
				<div className="flex items-center gap-2 py-[4px]">
					<Info
						size={16}
						aria-hidden="true"
						className="text-slate-50 drop-shadow-[0_0_10px_#59616b]"
					/>
					<h2 className="m-0 text-[13px] font-medium text-4xl font-black text-white [text-shadow:0_0_5px_#59616b]">
						{authenticating
							? "認証を待っています"
							: "認証が必要です"}
					</h2>
				</div>
				<div className="ml-auto flex shrink-0 items-center justify-end">
					{actions.map((method) => (
						<button
							key={method.id}
							type="button"
							className={cn(
								"m-0 h-8 px-3 text-[12px] leading-2",
								"group relative isolate shrink-0 overflow-hidden",
								"rounded-md border",
								"bg-zinc-950 text-white",
								"[border-color:color-mix(in_srgb,var(--vscode-button-border,#414851)_75%,transparent)]",
								"font-medium",
								"transition-colors duration-100",
								"hover:[border-color:var(--vscode-focusBorder,#007acc)]",
								"focus-visible:outline-none",
								"focus-visible:ring-1",
								"focus-visible:ring-[var(--vscode-focusBorder,#007acc)]",
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
									"bg-sky-300 text-black",
									"[clip-path:polygon(0_0,0_0,0_0)]",
									"transition-[clip-path] duration-300 ease-out motion-reduce:transition-none",
									"group-hover:[clip-path:polygon(0_0,200%_0,0_200%)]",
									"group-focus-visible:[clip-path:polygon(0_0,200%_0,0_200%)]",
								)}
							>
								{method.name}
							</span>
						</button>
					))}
				</div>
			</div>
			<p className="mb-0 mt-[-5px] pl-6 text-[12px]">{description}</p>
		</motion.section>
	);
}

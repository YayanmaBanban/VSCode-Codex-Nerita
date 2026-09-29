// 接続状態を操作可能なボタンで示し、再接続の誘導と成功演出を表示する。
import { cn } from "cnfast";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { BorderBeam } from "../../ui/BorderBeam";
import { ShinyText } from "../../ui/ShinyText";
import { SettingsTooltip } from "../SettingsTooltip";
import "./connectionButton.css";

const labels = {
	disconnected: "未接続",
	connecting: "接続中",
	ready: "接続済み",
	"auth-required": "認証して再接続",
	authenticating: "ログイン待ち",
	error: "接続エラー",
};

/** 状態の切り替えをカーテンで覆い、接続結果に応じた演出を表示する。 */
export function ConnectionButton({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const reduced = useReducedMotion();
	const previous = useRef(state.connection);
	const [celebrating, setCelebrating] = useState(false);
	const [displayed, setDisplayed] = useState(state.connection);
	const [curtain, setCurtain] = useState<{
		target: ChatState["connection"];
		phase: "cover" | "reveal";
	} | null>(null);
	const reconnectable = [
		"disconnected",
		"error",
		"auth-required",
		"authenticating",
	].includes(state.connection);
	const disabled =
		!reconnectable ||
		state.sessionPending ||
		state.run === "running" ||
		state.run === "cancelling";
	const action = connectionAction(state.connection);
	useEffect(() => {
		if (reduced) {
			setDisplayed(state.connection);
			setCurtain(null);
		} else if (previous.current !== state.connection) {
			// 途中で状態が変わった場合も、最新の状態色で覆い直す。
			setCurtain({ target: state.connection, phase: "cover" });
		}
		// 接続済みの状態を初めて表示しただけでは、紙吹雪を表示しない。
		const connected =
			previous.current !== "ready" &&
			previous.current !== "disconnected" &&
			state.connection === "ready";
		previous.current = state.connection;
		if (!connected || reduced) {
			setCelebrating(false);
			return;
		}
		setCelebrating(true);
		const timer = setTimeout(() => setCelebrating(false), 900);
		return () => clearTimeout(timer);
	}, [state.connection, reduced]);
	return (
		<div className="connection-control relative shrink-0">
			<SettingsTooltip
				content={reconnectable ? action : labels[state.connection]}
			>
				<button
					type="button"
					className={cn(
						"connection-button relative flex h-[28px] items-center gap-[5px] whitespace-nowrap px-[7px] py-0",
						"text-[12px] enabled:hover:border-[color-mix(in_srgb,var(--nerita-button-border)_55%,white)] disabled:opacity-100",
						connectionMouseCursor(displayed),
						connectionBgColor(displayed),
					)}
					data-connection={state.connection}
					disabled={disabled}
					aria-label={
						reconnectable
							? `${labels[state.connection]}：${action}`
							: labels[state.connection]
					}
					onClick={() =>
						send({
							type: "connection/retry",
							requestId: crypto.randomUUID(),
						})
					}
				>
					<span
						aria-hidden="true"
						className={cn(
							"status-dot size-[5px] rounded-full",
							connectionColor(displayed),
						)}
					/>
					<span role="status" className="font-medium">
						<ConnectionLabel
							connection={displayed}
							reduced={reduced === true}
						/>
					</span>
					{curtain && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
						>
							<span
								key={`${curtain.target}-${curtain.phase}`}
								className={cn(
									"connection-curtain absolute inset-0",
									connectionColor(curtain.target),
								)}
								data-phase={curtain.phase}
								data-target={curtain.target}
								onAnimationEnd={() => {
									if (curtain.target !== state.connection) {
										return;
									}
									if (curtain.phase === "cover") {
										setDisplayed(curtain.target);
										setCurtain({
											...curtain,
											phase: "reveal",
										});
									} else {
										setCurtain(null);
									}
								}}
							/>
						</span>
					)}
					{!reduced &&
						showConnectionBeam(
							state.connection,
							reconnectable,
							disabled,
						) && (
							<span
								aria-hidden="true"
								className="connection-beam pointer-events-none absolute inset-0 rounded-[inherit]"
							>
								<BorderBeam
									size={22}
									duration={3}
									colorFrom="var(--nerita-focus-border)"
									colorTo="var(--nerita-editor-warning-foreground)"
								/>
							</span>
						)}
				</button>
			</SettingsTooltip>
			{celebrating && (
				<span
					className="connection-confetti pointer-events-none absolute inset-0 z-20"
					aria-hidden="true"
				>
					{Array.from({ length: 12 }, (_, index) => (
						<i
							key={index}
							className={cn(`confetti-piece confetti-${index}`)}
						/>
					))}
				</span>
			)}
		</div>
	);
}

/** 待機中は操作の可否にかかわらず、境界線の演出を表示する。 */
function showConnectionBeam(
	connection: ChatState["connection"],
	reconnectable: boolean,
	disabled: boolean,
) {
	return (
		["connecting", "authenticating"].includes(connection) ||
		(reconnectable && !disabled)
	);
}

/** 接続処理中の文言だけに青い光沢を付ける。 */
function ConnectionLabel({
	connection,
	reduced,
}: {
	connection: ChatState["connection"];
	reduced: boolean;
}) {
	if (connection !== "connecting") {
		return labels[connection];
	}
	return (
		<ShinyText
			text={labels[connection]}
			disabled={reduced}
			color="var(--nerita-text-link-foreground)"
			shineColor="var(--nerita-foreground)"
		/>
	);
}

/** 接続状態に応じて再接続操作の文言を返す。 */
function connectionAction(connection: ChatState["connection"]) {
	if (connection === "disconnected") {
		return "接続する";
	}
	if (connection === "authenticating") {
		return "ログインを中止して再接続";
	}
	return "アカウントを再認証して接続します";
}

/** 接続エラー・接続済み・接続中・その他の状態を色分けする。 */
function connectionColor(connection: ChatState["connection"]) {
	if (connection === "error") {
		return "bg-tool-error";
	}
	if (connection === "ready") {
		return "bg-menu-check";
	}
	if (connection === "authenticating") {
		return "bg-[var(--nerita-editor-info-foreground)]";
	}
	if (connection !== "connecting") {
		return "bg-warning";
	}
	return "bg-[var(--nerita-editor-info-foreground)]";
}

/** 接続成功とそれ以外を背景色で区別する。 */
function connectionBgColor(connection: ChatState["connection"]) {
	if (
		connection === "ready" ||
		connection === "connecting" ||
		connection === "authenticating"
	) {
		return "bg-transparent";
	}
	return "bg-message-user";
}

/** 接続成功とそれ以外のマウスカーソルの状態。 */
function connectionMouseCursor(connection: ChatState["connection"]) {
	return connection === "ready" ||
		connection === "connecting" ||
		connection === "authenticating"
		? ""
		: "cursor-pointer";
}

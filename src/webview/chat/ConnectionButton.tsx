// 接続状態を操作可能なボタンで示し、再接続の誘導と成功演出を表示する。
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { ChatState, UiMessage } from "../../shared/messages";
import { BorderBeam } from "../../components/lightswind/border-beam";
import { SettingsTooltip } from "./SettingsTooltip";
import "./connectionButton.css";

const labels = {
	disconnected: "未接続",
	connecting: "接続中",
	ready: "接続済み",
	"auth-required": "認証が必要",
	authenticating: "ログイン待ち",
	error: "接続エラー",
};

/** 状態が接続済みに変わった時だけ紙吹雪を一度表示する。 */
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
	const action =
		state.connection === "disconnected"
			? "接続する"
			: state.connection === "authenticating"
				? "ログインを中止して再接続"
				: "再接続";
	useEffect(() => {
		// 接続済みのスナップショットを初めて表示しただけでは祝福しない。
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
					className="connection-button relative flex h-[28px] items-center gap-[5px] whitespace-nowrap bg-transparent px-[7px] py-0 text-[12px] disabled:opacity-100"
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
						className={`status-dot size-[5px] rounded-full ${state.connection === "ready" ? "bg-menu-check" : reconnectable ? "bg-warning" : "bg-muted"}`}
					/>
					<span role="status">{labels[state.connection]}</span>
					{reconnectable && !disabled && !reduced && (
						<span
							aria-hidden="true"
							className="connection-beam pointer-events-none absolute inset-0 rounded-[inherit]"
						>
							<BorderBeam
								size={22}
								duration={3}
								colorFrom="var(--vscode-focusBorder, #6dadc9)"
								colorTo="var(--vscode-editorWarning-foreground, #deb86d)"
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
							className={`confetti-piece confetti-${index}`}
						/>
					))}
				</span>
			)}
		</div>
	);
}

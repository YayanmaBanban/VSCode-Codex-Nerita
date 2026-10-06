// 接続状態を操作可能なボタンで示し、再接続の誘導と成功演出を表示する。

import {
	type ReactNode,
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";

import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { cn } from "cnfast";
import { useReducedMotion } from "motion/react";

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

/** 接続状態と、再接続要求を送る関数。 */
type ConnectionButtonProps = {
	state: ChatState;
	send: (message: UiMessage) => void;
};

/** 状態の切り替えをカーテンで覆い、接続結果に応じた演出を表示する。 */
export function ConnectionButton({ state, send }: ConnectionButtonProps) {
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
		if (reduced === true) {
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
		if (!connected || reduced === true) {
			setCelebrating(false);
			return;
		}
		setCelebrating(true);
		const timer = setTimeout(() => setCelebrating(false), 900);
		return () => clearTimeout(timer);
	}, [state.connection, reduced]);
	return (
		<div className="connection-control relative shrink-0">
			<ConnectionTrigger
				reconnectable={reconnectable}
				action={action}
				state={state}
				displayed={displayed}
				disabled={disabled}
				send={send}
				reduced={reduced}
				curtain={curtain}
				setDisplayed={setDisplayed}
				setCurtain={setCurtain}
			/>
			{celebrating && (
				<span
					className="connection-confetti pointer-events-none absolute inset-0 z-20"
					aria-hidden="true"
				>
					{Array.from({ length: 12 }, (_, index) => (
						<i
							key={index}
							className={cn(
								"confetti-piece",
								`confetti-${index}`,
							)}
						/>
					))}
				</span>
			)}
		</div>
	);
}

/** 再接続の可否・表示文言と、接続状態の遷移に使う演出の状態。 */
type ConnectionTriggerProps = {
	reconnectable: boolean;
	action:
		| "接続する"
		| "ログインを中止して再接続"
		| "アカウントを再認証して接続します";
	state: ChatState;
	displayed:
		| "disconnected"
		| "connecting"
		| "ready"
		| "auth-required"
		| "authenticating"
		| "error";
	disabled: boolean;
	send: (message: UiMessage) => void;
	reduced: null | false | true;
	curtain: null | {
		target: ChatState["connection"];
		phase: "cover" | "reveal";
	};
	setDisplayed: Dispatch<
		SetStateAction<
			| "disconnected"
			| "connecting"
			| "ready"
			| "auth-required"
			| "authenticating"
			| "error"
		>
	>;
	setCurtain: Dispatch<
		SetStateAction<{
			target: ChatState["connection"];
			phase: "cover" | "reveal";
		} | null>
	>;
};

/** 再接続ボタンの配置・文字と、操作状態ごとの境界線を定義する。 */
const connectionTriggerStyle = cn(
	"connection-button relative flex h-[28px] items-center gap-[5px] px-[7px] py-0",
	"whitespace-nowrap",
	"text-[12px]",
	"enabled:hover:border-[color-mix(in_srgb,var(--nerita-button-border)_55%,white)]",
	"disabled:opacity-100",
);

/** 接続状態と遷移の演出を再接続ボタンへ表示する。 */
function ConnectionTrigger(props: ConnectionTriggerProps) {
	const {
		reconnectable,
		action,
		state,
		displayed,
		disabled,
		send,
		reduced,
		curtain,
	} = props;
	return (
		<SettingsTooltip
			content={reconnectable ? action : labels[state.connection]}
		>
			<button
				type="button"
				className={cn(
					connectionTriggerStyle,
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
				{curtain && <ConnectionCurtain {...props} curtain={curtain} />}
				{!(reduced === true) &&
					showConnectionBeam(
						state.connection,
						reconnectable,
						disabled,
					) && (
						<span
							aria-hidden="true"
							className={cn(
								"connection-beam pointer-events-none absolute inset-0 rounded-[inherit]",
							)}
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
	);
}

/** 接続状態を切り替えるカーテンの進行状態と、表示状態の更新操作。 */
type ConnectionCurtainProps = {
	curtain: {
		target: ChatState["connection"];
		phase: "cover" | "reveal";
	};
	state: ChatState;
	setDisplayed: Dispatch<
		SetStateAction<
			| "disconnected"
			| "connecting"
			| "ready"
			| "auth-required"
			| "authenticating"
			| "error"
		>
	>;
	setCurtain: Dispatch<
		SetStateAction<{
			target: ChatState["connection"];
			phase: "cover" | "reveal";
		} | null>
	>;
};

/** 最新の接続状態に一致する演出だけを完了させる。 */
function ConnectionCurtain({
	curtain,
	state,
	setDisplayed,
	setCurtain,
}: ConnectionCurtainProps): ReactNode {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
			)}
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

/** 接続状態と、光沢の動きを抑制するかどうかの指定。 */
type ConnectionLabelProps = {
	connection: ChatState["connection"];
	reduced: boolean;
};

/** 接続処理中の文言だけに青い光沢を付ける。 */
function ConnectionLabel({ connection, reduced }: ConnectionLabelProps) {
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

/** 接続済み・接続中・認証中は背景を透明にし、それ以外には背景色を付ける。 */
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

/** 接続済み・接続中・認証中以外では、マウスカーソルを操作可能な形にする。 */
function connectionMouseCursor(connection: ChatState["connection"]) {
	return connection === "ready" ||
		connection === "connecting" ||
		connection === "authenticating"
		? ""
		: "cursor-pointer";
}

<!-- 接続状態の切り替えをカーテンで覆い、再接続と成功の演出を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import { untrack } from "svelte";
	import { prefersReducedMotion } from "svelte/motion";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import BorderBeam from "../../ui/BorderBeam.svelte";
	import ShinyText from "../../ui/ShinyText.svelte";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import "./connectionButton.css";
	let {
		state: chatState,
		send,
	}: { state: ChatState; send: (message: UiMessage) => void } = $props();
	const labels = {
		disconnected: "未接続",
		connecting: "接続中",
		ready: "接続済み",
		"auth-required": "認証して再接続",
		authenticating: "ログイン待ち",
		error: "接続エラー",
	};
	const confetti = Array.from({ length: 12 }, (_, index) => index);
	let previous = untrack(() => chatState.connection);
	let celebrating = $state(false);
	let displayed = $state(untrack(() => chatState.connection));
	let curtain = $state<{
		target: ChatState["connection"];
		phase: "cover" | "reveal";
	} | null>(null);
	const reconnectable = $derived(
		["disconnected", "error", "auth-required", "authenticating"].includes(
			chatState.connection,
		),
	);
	const blockedSession = $derived(
		!reconnectable ||
			chatState.sessionPending ||
			chatState.run === "running",
	);
	const disabled = $derived(blockedSession || chatState.run === "cancelling");
	const action = $derived(connectionAction(chatState.connection));
	const showBeam = $derived(
		["connecting", "authenticating"].includes(chatState.connection) ||
			(reconnectable && !disabled),
	);
	// 外部の接続状態を演出の表示状態へ同期し、短時間の連続変更では最新の状態を優先する。
	function synchronizeConnectionFeedback() {
		const connection = chatState.connection;
		const reduced = prefersReducedMotion.current;
		if (reduced) {
			displayed = connection;
			curtain = null;
		} else if (previous !== connection) {
			curtain = { target: connection, phase: "cover" };
		}
		const connected =
			previous !== "ready" &&
			previous !== "disconnected" &&
			connection === "ready";
		previous = connection;
		if (!connected || reduced) {
			celebrating = false;
			return;
		}
		celebrating = true;
		const timer = setTimeout(() => {
			celebrating = false;
		}, 900);
		return () => clearTimeout(timer);
	}
	// 外部の接続状態や動きの設定が変わると演出を開始・停止し、旧成功表示のタイマーを取り消す。
	$effect(synchronizeConnectionFeedback);
	/** 遅れて終わった旧状態の演出を、最新状態へ適用しない。 */
	function finishCurtain(
		target: ChatState["connection"],
		phase: "cover" | "reveal",
	) {
		if (target !== chatState.connection) {
			return;
		}
		if (!curtain || curtain.target !== target || curtain.phase !== phase) {
			return;
		}
		if (phase === "cover") {
			displayed = target;
			curtain = { target, phase: "reveal" };
		} else {
			curtain = null;
		}
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
		const matchesConnection =
			connection === "ready" ||
			connection === "connecting" ||
			connection === "authenticating";
		if (matchesConnection) {
			return "bg-transparent";
		}
		return "bg-message-user";
	}

	/** 接続済み・接続中・認証中以外では、マウスカーソルを操作可能な形にする。 */
	function connectionMouseCursor(connection: ChatState["connection"]) {
		const matchesConnection2 = !(
			connection === "ready" ||
			connection === "connecting" ||
			connection === "authenticating"
		);
		if (matchesConnection2) {
			return "cursor-pointer";
		}
		return "";
	}
</script>

<div class="connection-control relative shrink-0">
	<SettingsTooltip
		content={reconnectable ? action : labels[chatState.connection]}
		>{#snippet children({ props })}
			<button
				{...mergeProps(props, {
					onclick: () =>
						send({
							type: "connection/retry",
							requestId: crypto.randomUUID(),
						}),
				})}
				type="button"
				class={cn(
					"connection-button relative flex h-[28px] items-center gap-[5px] px-[7px] py-0 text-[12px] whitespace-nowrap enabled:hover:border-[color-mix(in_srgb,var(--nerita-button-border)_55%,white)] disabled:opacity-100",
					connectionMouseCursor(displayed),
					connectionBgColor(displayed),
				)}
				data-connection={chatState.connection}
				{disabled}
				aria-label={reconnectable
					? `${labels[chatState.connection]}：${action}`
					: labels[chatState.connection]}
			>
				<span
					aria-hidden="true"
					class={cn(
						"status-dot size-[5px] rounded-full",
						connectionColor(displayed),
					)}
				></span>
				<span role="status" class="font-medium"
					>{#if displayed === "connecting"}<ShinyText
							text={labels[displayed]}
							disabled={prefersReducedMotion.current}
							color="var(--nerita-text-link-foreground)"
							shineColor="var(--nerita-foreground)"
						/>{:else}{labels[displayed]}{/if}</span
				>
				{#if curtain}{@const target = curtain.target}{@const phase =
						curtain.phase}<span
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
						>{#key `${target}-${phase}`}<span
								class={cn(
									"connection-curtain absolute inset-0",
									connectionColor(target),
								)}
								data-phase={phase}
								data-target={target}
								onanimationend={() =>
									finishCurtain(target, phase)}
							></span>{/key}</span
					>{/if}
				{#if !prefersReducedMotion.current && showBeam}<span
						aria-hidden="true"
						class="connection-beam pointer-events-none absolute inset-0 rounded-[inherit]"
						><BorderBeam
							size={22}
							duration={3}
							colorFrom="var(--nerita-focus-border)"
							colorTo="var(--nerita-editor-warning-foreground)"
						/></span
					>{/if}
			</button>
		{/snippet}</SettingsTooltip
	>
	{#if celebrating}<span
			class="connection-confetti pointer-events-none absolute inset-0 z-20"
			aria-hidden="true"
			>{#each confetti as index (index)}<i
					class={cn("confetti-piece", `confetti-${index}`)}
				></i>{/each}</span
		>{/if}
</div>

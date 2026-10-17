<script lang="ts">
	// 既存の固定応答を各プレビューで独立して保持する。

	import TrustManager from "../../src/trust/TrustManager.svelte";
	import type {
		TrustBridge,
		TrustReply,
		TrustRequest,
		TrustConfirmation,
	} from "@nerita/shared/workspaceTrust";
	import type { BackendId } from "@nerita/shared/backend";

	let {
		backend = "pi",
		manual = false,
		empty = false,
		error = false,
	}: {
		backend?: BackendId;
		manual?: boolean;
		empty?: boolean;
		error?: boolean;
	} = $props();
	const sent: TrustRequest[] = [];
	let deliver: (reply: TrustReply) => void = () => {};
	let confirmation: TrustConfirmation | null = null;
	let revision = 0;
	const storyError = $derived(
		error
			? "信頼設定を更新できませんでした。再読み込みしてから再試行してください。"
			: null,
	);
	/** Host の確認応答だけを代替し、確定前には保存結果を変更しない。 */
	function confirmRequest(
		message: TrustRequest,
		selectedBackend: BackendId,
	): boolean {
		if (message.type !== "trust") {
			confirmation = null;
			return false;
		}
		if (
			message.confirmationId !== undefined &&
			message.confirmationId === confirmation?.id
		) {
			confirmation = null;
			return true;
		}
		confirmation = {
			id: "story-confirmation",
			root: message.root,
			canonical: message.root,
			external: false,
			backend: selectedBackend,
		};
		return false;
	}

	const bridge = ((): TrustBridge => {
		let listener: ((state: TrustReply) => void) | undefined;
		let selectedBackend: BackendId | undefined;
		const recordsByBackend: Record<BackendId, TrustReply["records"]> = {
			codex: [
				{
					root: "projects/codex-trusted",
					trust: "trusted",
					origin: "workspace",
					updatedAt: null,
				},
				{
					root: "projects/codex-untrusted",
					trust: "untrusted",
					origin: "workspace",
					updatedAt: null,
				},
				{
					root: "projects/codex-unset",
					trust: "unset",
					origin: "workspace",
					updatedAt: null,
				},
			],
			pi: [
				{
					root: "projects/current-project",
					trust: "trusted",
					origin: "workspace",
					updatedAt: 1800000000000,
				},
				{
					root: "projects/archived-project/以前使用していた長い名前のワークスペース",
					trust: "untrusted",
					origin: "workspace",
					updatedAt: 1700000000000,
				},
				{
					root: "cache/repositories",
					trust: "untrusted",
					origin: "external-cache",
					updatedAt: 1700000000000,
				},
			],
		};
		return {
			subscribe: (next) => {
				listener = next;
				deliver = next;
				return () => {
					listener = undefined;
				};
			},
			postMessage: (message) => {
				sent.push(message);
				if (manual) {
					return;
				}
				selectedBackend = message.backend ?? selectedBackend ?? backend;
				let records = empty ? [] : recordsByBackend[selectedBackend];
				if (message.type === "remove") {
					records = records.filter(
						(record) => record.root !== message.root,
					);
				}
				const confirmed = confirmRequest(message, selectedBackend);
				if (
					message.type === "revoke" ||
					(message.type === "trust" && confirmed)
				) {
					records = records.map((record) =>
						record.root === message.root
							? {
									...record,
									trust:
										message.type === "trust"
											? "trusted"
											: "untrusted",
								}
							: record,
					);
				}
				recordsByBackend[selectedBackend] = records;
				listener?.({
					type: "state",
					requestId: message.requestId,
					revision: ++revision,
					confirmation,
					backend: selectedBackend,
					piStoragePath: "User/globalStorage/state.vscdb",
					records,
					error: storyError,
				});
			},
		};
	})();
</script>

<div
	data-story-trust
	{@attach (element) => {
		Object.assign(element, {
			sent,
			emit: (reply: TrustReply) => deliver(reply),
		});
	}}
>
	<TrustManager {bridge} />
</div>

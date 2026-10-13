<script lang="ts">
	// 既存の固定応答を各プレビューで独立して保持する。
	import { untrack } from "svelte";
	import SandboxSettings from "../../src/pi/SandboxSettings.svelte";
	import type {
		SandboxBridge,
		SandboxReply,
		SandboxSnapshot,
	} from "@nerita/shared/sandboxManagement";

	const snapshot: SandboxSnapshot = {
		selected: "mxc",
		availability: [
			{
				id: "mxc",
				name: "Microsoft MXC",
				available: true,
				isolationTier: "base-container",
				availableMethods: ["processcontainer"],
				uiCapabilities: {
					canBlockClipboardRead: true,
					canBlockInputInjection: true,
				},
			},
			{
				id: "docker",
				name: "Docker",
				available: false,
				reason: "準備中",
				availableMethods: [],
				uiCapabilities: {},
			},
		],
		grants: [
			{
				permission: {
					tool: "pnpm",
					commandClass: "read-only-ish",
					workspace:
						"projects/長い名前のワークスペース/日本語のプロジェクト",
					route: "host",
				},
				scope: "workspace",
			},
		],
		resources: [
			{
				id: "node",
				kind: "install",
				target: "tools/node",
				access: "read",
				source: "profile",
				tool: "node",
				scope: "process",
			},
			{
				id: "cache",
				kind: "cache",
				target: "managed-cache/workspace",
				access: "readwrite",
				source: "profile",
				tool: "pnpm",
				scope: "workspace",
			},
		],
		resourceGrants: [
			{
				id: "grant",
				resource: {
					kind: "helper",
					target: "tools/node/helper.exe",
					tool: "node",
					profileTarget: "tools/node",
				},
				access: "read",
				scope: "workspace",
				source: "denial",
				workspace: "projects/workspace",
				denialEventId: "old",
				operationId: "previous",
			},
		],
		cacheSwitches: [
			{
				id: "cache-switch",
				workspace: "projects/workspace",
				tool: "pnpm",
			},
		],
		denials: [
			{
				id: "helper-denial",
				target: "tools/node/日本語と長い名前の補助プログラム/helper.exe",
				resourceType: "file",
				requestedAccess: "read",
				resource: {
					id: "helper",
					kind: "helper",
					target: "tools/node",
					access: "deny",
					source: "denial",
					tool: "node",
					scope: "process",
				},
				estimatedTool: "node",
				actions: ["allow", "deny"],
			},
			{
				id: "cache-denial",
				target: "host-cache/pnpm/store",
				resourceType: "file",
				requestedAccess: "write",
				resource: {
					id: "host-cache",
					kind: "cache",
					target: "host-cache/pnpm",
					access: "deny",
					source: "denial",
					tool: "pnpm",
					scope: "process",
				},
				actions: ["use-sandbox-cache", "deny"],
			},
			{
				id: "diagnostic",
				target: "Object Manager diagnostic",
				resourceType: "other",
				requestedAccess: "unknown",
				actions: [],
			},
		],
		reportStatus: "reported",
	};

	let { unavailable = false }: { unavailable?: boolean } = $props();
	const bridge = untrack<SandboxBridge>(() => {
		let listener: ((reply: SandboxReply) => void) | undefined;
		const state = structuredClone(snapshot);
		if (unavailable) {
			state.availability[0] = {
				...state.availability[0]!,
				available: false,
				reason: "MXC 起動検査に失敗しました。選択中の実行環境を確認してください。",
			};
		}
		return {
			subscribe: (next) => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
			postMessage: (message) => {
				if (message.type !== "ready" && message.type !== "probe") {
					listener?.({
						type: "error",
						message: "保存に失敗しました。承認は保持されています。",
					});
				}
				listener?.({ type: "state", state, busy: false });
			},
		};
	});
</script>

<SandboxSettings {bridge} />

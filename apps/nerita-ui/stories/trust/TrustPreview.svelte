<script lang="ts">
	// 既存の固定応答を各プレビューで独立して保持する。

	import TrustManager from "../../src/trust/TrustManager.svelte";
	import type {
		TrustBridge,
		TrustReply,
	} from "@nerita/shared/workspaceTrust";

	const bridge = ((): TrustBridge => {
		let listener: ((state: TrustReply) => void) | undefined;
		let records: TrustReply["records"] = [
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
		];
		return {
			subscribe: (next) => {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
			postMessage: (message) => {
				if (message.type === "remove") {
					records = records.filter(
						(record) => record.root !== message.root,
					);
				}
				if (message.type === "trust" || message.type === "revoke") {
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
				listener?.({ type: "state", records, error: null });
			},
		};
	})();
</script>

<TrustManager {bridge} />

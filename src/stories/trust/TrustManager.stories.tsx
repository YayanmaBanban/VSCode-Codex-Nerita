// 実画面の検索・削除・空状態を、保存先を変更せず確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TrustManager } from "../../webview/trust/TrustManager";
import type { TrustBridge, TrustReply } from "../../shared/workspaceTrust";

/** Host の応答だけを模擬し、操作後も同じコンポーネントを表示する。 */
function Preview() {
	const bridge = useMemo<TrustBridge>(() => {
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
	}, []);
	return <TrustManager bridge={bridge} />;
}
const meta = { title: "Trust/Manager", component: Preview } satisfies Meta<
	typeof Preview
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};

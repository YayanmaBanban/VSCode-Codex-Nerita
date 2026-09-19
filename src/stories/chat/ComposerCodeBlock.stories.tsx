// Hostのメニュー通知を代替し、実入力欄の選択保持と変換を観察する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComposerPart } from "../../shared/composerContent";
import { isRecord } from "../../shared/validation";
import { ComposerInput } from "../../webview/chat/ComposerInput";
import { createMockBridge } from "./mocks/mockBridge";
import "../../webview/chat/chat.css";

/** 標準メニューの代わりに通知ボタンを置き、フォーカス移動も再現する。 */
function CodeBlockStory() {
	const bridge = useMemo(() => createMockBridge(), []);
	const [locked, setLocked] = useState(false);
	const [requestId, setRequestId] = useState<string>();
	const [parts, setParts] = useState<ComposerPart[]>([
		{ id: "text", type: "text", text: "前文選択する本文後文" },
	]);
	return (
		<div
			className="p-4"
			onContextMenu={(event) => {
				// Hostと同様にメニューを開いた時点の識別子を保持し、古い通知も再現する。
				const context = event.currentTarget
					.querySelector("[data-vscode-context]")
					?.getAttribute("data-vscode-context");
				const parsed: unknown = context
					? JSON.parse(context)
					: undefined;
				setRequestId(
					isRecord(parsed) &&
						typeof parsed.composerSelectionId === "string"
						? parsed.composerSelectionId
						: undefined,
				);
			}}
		>
			<ComposerInput
				bridge={bridge}
				parts={parts}
				onChange={setParts}
				onSubmit={() => {}}
				locked={locked}
			/>
			<button
				type="button"
				onClick={() => {
					if (typeof requestId === "string") {
						bridge.emit({ type: "ui/codeBlock", requestId });
					}
				}}
			>
				Hostのコードブロック化を通知
			</button>
			<button type="button" onClick={() => setLocked(!locked)}>
				入力ロック切替
			</button>
			<button
				type="button"
				onClick={() =>
					setParts([
						{
							id: "reference",
							type: "text",
							text: "前src後",
							references: [
								{
									offset: 1,
									path: {
										uri: "file:///D:/src",
										path: "src",
										name: "src",
										kind: "directory",
									},
								},
							],
						},
					])
				}
			>
				参照を含む下書き
			</button>
			<output aria-label="下書き">{JSON.stringify(parts)}</output>
		</div>
	);
}
const meta = {
	title: "Chat/Composer Code Block",
	component: CodeBlockStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CodeBlockStory>;
export default meta;
/** 選択範囲と通知の対応を確認するStory。 */
type Story = StoryObj<typeof meta>;
export const Selection: Story = {};

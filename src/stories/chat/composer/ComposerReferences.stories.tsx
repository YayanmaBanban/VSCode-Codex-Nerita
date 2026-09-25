// 保存済みのパスチップを復元し、表示先移動・長い名前・削除を確認する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../../webview/chat/ChatApp";
import type { Bridge } from "../../../webview/vscodeBridge";
import type { ComposerPart } from "../../../shared/composerContent";
import { pathText } from "../../../shared/composerReferences";
import { createMockBridge } from "../mocks/mockBridge";

/** Host の下書き復元と表示先ごとの再マウントを再現する。 */
function ReferenceStory() {
	const [view, setView] = useState(false);
	const [opened, setOpened] = useState("");
	const bridge = useMemo(() => {
		const mock = createMockBridge();
		const file = {
			uri: "file:///D:/workspace/日本語%20sample.md",
			name: "日本語 sample.md",
			path: "D:\\workspace\\日本語 sample.md",
			kind: "file" as const,
		};
		const folder = {
			uri: "file:///D:/workspace/src",
			name: "src",
			path: "D:\\workspace\\src",
			kind: "directory" as const,
		};
		const prefix = `前文${pathText(file)} と `;
		let parts: ComposerPart[] = [
			{
				id: "references",
				type: "text",
				text: `${prefix}${pathText(folder)} 後文`,
				references: [
					{ offset: 2, path: file },
					{ offset: prefix.length, path: folder },
				],
			},
		];
		let editor = false;
		const restore = () =>
			mock.emit({
				type: "ui/viewState",
				editor,
				draft: parts.map((part) => part.text).join(""),
				draftParts: parts,
				scrollTop: 0,
				restoreScroll: true,
			});
		return {
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "reference/open") {
					setOpened(message.uri);
					return;
				}
				if (message.type === "ui/saveDraft") {
					parts = message.draftParts ?? [
						{ id: "text", type: "text", text: message.draft },
					];
					return;
				}
				if (
					message.type === "ui/openEditor" ||
					message.type === "ui/openSidebar"
				) {
					editor = message.type === "ui/openEditor";
					setView(editor);
					return;
				}
				mock.postMessage(message);
				if (message.type === "ui/ready") {
					restore();
				}
			},
		} satisfies Bridge;
	}, []);
	return (
		<>
			<ChatApp key={String(view)} bridge={bridge} />
			<output aria-label="開いた参照">{opened}</output>
		</>
	);
}
const meta = {
	title: "Chat/Composer References",
	component: ReferenceStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReferenceStory>;
export default meta;
/** 文中にファイル・フォルダのチップを持つ保存済み下書き。 */
type Story = StoryObj<typeof meta>;
export const Restored: Story = {};

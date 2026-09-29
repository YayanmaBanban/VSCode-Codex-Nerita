// ファイル選択・ドロップの固定応答を返す。設定や会話の遷移は扱わない。
import type { ChatState } from "@nerita/shared/chatState";
import type { StoryBridge } from "./storyBridge";
/** ファイルダイアログに相当する表示用の添付一覧を保持する。 */
export function withAttachmentResources(bridge: StoryBridge): StoryBridge {
	let attachments: ChatState["attachments"] = [];
	return {
		...bridge,
		postMessage(message) {
			bridge.postMessage(message);
			const state = { attachments };
			const reply = (() => {
				if (message.type === "attachment/add") {
					if (message.files) {
						const attachments = new Map(
							state.attachments.map((file) => [file.uri, file]),
						);
						for (const file of message.files) {
							const uri =
								"uri" in file
									? file.uri
									: `file:///dropped/${encodeURIComponent(file.name)}`;
							attachments.set(uri, {
								id: uri,
								name: decodeURIComponent(
									uri.split("/").at(-1)!,
								),
								uri,
							});
						}
						return { attachments: [...attachments.values()] };
					}
					return {
						attachments: [
							{
								id: "source",
								name: "settings.ts",
								uri: "file:///workspace/settings.ts",
							},
							{
								id: "image",
								name: "design.png",
								uri: "file:///workspace/design.png",
							},
						],
					};
				}
				if (message.type === "attachment/remove") {
					return {
						attachments: state.attachments.filter(
							(file) => file.id !== message.attachmentId,
						),
					};
				}
				return undefined;
			})();
			if (reply) {
				attachments = reply.attachments;
				bridge.patchState(reply);
			}
		},
	};
}

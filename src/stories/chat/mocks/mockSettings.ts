// Story 内で設定・添付操作の Host 応答を再現する。
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";

/** 設定に依存する選択肢と添付の変更を状態差分として返す。 */
export function mockSettings(
	state: ChatState,
	message: UiMessage,
): Partial<ChatState> | undefined {
	if (message.type === "config/set") {
		return {
			configOptions: state.configOptions.map((option) => {
				if (option.id === message.configId) {
					return { ...option, currentValue: message.value };
				}
				if (
					message.configId === "model" &&
					option.id === "reasoning_effort"
				) {
					return {
						...option,
						currentValue: "low",
						options: option.options.filter(
							(choice) => choice.value !== "ultra",
						),
					};
				}
				return option;
			}),
		};
	}
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
					name: decodeURIComponent(uri.split("/").at(-1)!),
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
}

// 現在の認証とモデル一覧を利用し、会話やツールを作らず要約だけを生成する。
import { piThinkingSchema } from "@nerita/shared/agentManager/config";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { HandoffRequest } from "../../session/HandoffContext";

/** 選択されたモデルへ推論指定と取消を渡し、異常終了を要約として採用しない。 */
export async function generatePiHandoff(
	models: ModelRuntime,
	request: HandoffRequest,
	efforts: string[] = [],
) {
	const model = models
		.getAvailableSnapshot()
		.find((item) => `${item.provider}/${item.id}` === request.model);
	if (!model) {
		throw new Error("ハンドオフ用モデルを利用できません。");
	}
	if (isNonEmptyString(request.effort) && !efforts.includes(request.effort)) {
		throw new Error("ハンドオフ用の推論レベルを利用できません。");
	}
	const response = await models.completeSimple(
		model,
		{
			systemPrompt: request.systemPrompt,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: request.prompt }],
					timestamp: Date.now(),
				},
			],
		},
		piHandoffOptions(request),
	);
	if (response.stopReason !== "stop") {
		throw new Error("ハンドオフ生成が完了しませんでした。");
	}
	return response.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

/** ハンドオフは委譲せず、SDK の通常推論だけをモデルへ指定する。 */
function piHandoffOptions(
	request: HandoffRequest,
): NonNullable<Parameters<ModelRuntime["completeSimple"]>[2]> {
	if (request.effort === "ultra") {
		throw new Error(
			"子起動ツールのないハンドオフ生成では Ultra を指定できません。",
		);
	}
	const reasoning = request.effort;
	return {
		signal: request.signal,
		...(isNonEmptyString(reasoning) && reasoning !== "off"
			? {
					reasoning: piThinkingSchema
						.exclude(["off"])
						.parse(reasoning),
				}
			: {}),
		cacheRetention: "none",
	};
}

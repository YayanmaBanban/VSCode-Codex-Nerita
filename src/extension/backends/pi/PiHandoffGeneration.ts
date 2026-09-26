// 現在の認証とモデル一覧を利用し、会話やツールを作らず要約だけを生成する。
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { HandoffRequest } from "../../session/HandoffContext";
import { isRecord } from "../../../shared/validation";

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
	if (request.effort && !efforts.includes(request.effort)) {
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
		piHandoffOptions(model.api, request),
	);
	if (response.stopReason !== "stop") {
		throw new Error("ハンドオフ生成が完了しませんでした。");
	}
	return response.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}

/** Ultra は対応する Responses 要求だけに適用し、標準推論と区別する。 */
function piHandoffOptions(
	api: string,
	request: HandoffRequest,
): NonNullable<Parameters<ModelRuntime["completeSimple"]>[2]> {
	const ultra = request.effort === "ultra";
	if (ultra && api !== "openai-codex-responses") {
		throw new Error("このモデルでは Ultra を指定できません。");
	}
	const reasoning = ultra ? "high" : request.effort;
	return {
		signal: request.signal,
		...(reasoning && reasoning !== "off"
			? {
					reasoning: reasoning as NonNullable<
						NonNullable<
							Parameters<ModelRuntime["completeSimple"]>[2]
						>["reasoning"]
					>,
				}
			: {}),
		...(ultra
			? {
					onPayload: (payload: unknown) => {
						if (!isRecord(payload)) {
							throw new Error("Invalid handoff payload");
						}
						return {
							...payload,
							reasoning: {
								...(isRecord(payload.reasoning)
									? payload.reasoning
									: {}),
								effort: "ultra",
							},
						};
					},
				}
			: {}),
		cacheRetention: "none",
	};
}

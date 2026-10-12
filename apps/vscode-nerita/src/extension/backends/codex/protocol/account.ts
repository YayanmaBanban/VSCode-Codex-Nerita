// アカウント・モデル一覧の応答から、UI に必要な検証済み情報だけを取り出す。
import type { Model } from "../codex-app-server/v2/Model";
import type { LoginAccountResponse } from "../codex-app-server/v2/LoginAccountResponse";
import { isRecord } from "@nerita/shared/validation";

/** モデル設定と画像入力の可否を判断するためのカタログ情報。 */
export type ModelInfo = Pick<
	Model,
	| "model"
	| "displayName"
	| "supportedReasoningEfforts"
	| "defaultReasoningEffort"
	| "inputModalities"
	| "serviceTiers"
>;
/** 推論量は拡張可能な文字列として検証し、選択時にカタログと照合する。 */
export function isEffort(
	value: unknown,
): value is ModelInfo["defaultReasoningEffort"] {
	return typeof value === "string" && value.length > 0;
}
/** ページ単位でモデル候補を検証し、未使用の属性は公開しない。 */
export function parseModels(value: unknown): {
	data: ModelInfo[];
	nextCursor: string | null;
} {
	if (!isRecord(value) || !Array.isArray(value.data)) {
		throw new Error("Invalid model catalog");
	}
	if (!(value.nextCursor === null || typeof value.nextCursor === "string")) {
		throw new Error("Invalid model catalog");
	}
	const data = value.data.map(parseModel);
	return { data, nextCursor: value.nextCursor };
}
/** クライアントが開始する2つの認証方式だけを検証する。 */
export function parseLogin(
	value: unknown,
): Extract<LoginAccountResponse, { type: "chatgpt" | "apiKey" }> {
	if (!isRecord(value)) {
		throw new Error("Invalid login response");
	}
	if (value.type === "apiKey") {
		return { type: "apiKey" };
	}
	if (value.type !== "chatgpt") {
		throw new Error("Invalid login response");
	}
	if (typeof value.loginId !== "string") {
		throw new Error("Invalid login response");
	}
	if (typeof value.authUrl !== "string") {
		throw new Error("Invalid login response");
	}
	return {
		type: "chatgpt",
		loginId: value.loginId,
		authUrl: value.authUrl,
	};
}

/** 各モデルの入力形式・推論量・サービス階層を検証して公開属性だけを返す。 */
function parseModel(entry: unknown): ModelInfo {
	if (!isRecord(entry)) {
		throw new Error("Invalid model");
	}
	if (typeof entry.model !== "string") {
		throw new Error("Invalid model");
	}
	if (typeof entry.displayName !== "string") {
		throw new Error("Invalid model");
	}

	if (!isEffort(entry.defaultReasoningEffort)) {
		throw new Error("Invalid model");
	}
	if (!Array.isArray(entry.supportedReasoningEfforts)) {
		throw new Error("Invalid model");
	}
	if (!Array.isArray(entry.inputModalities)) {
		throw new Error("Invalid model");
	}
	if (!Array.isArray(entry.serviceTiers)) {
		throw new Error("Invalid model");
	}
	const supportedReasoningEfforts = entry.supportedReasoningEfforts.map(
		(effort: unknown) => {
			if (!isRecord(effort)) {
				throw new Error("Invalid reasoning option");
			}
			if (!isEffort(effort.reasoningEffort)) {
				throw new Error("Invalid reasoning option");
			}
			if (typeof effort.description !== "string") {
				throw new Error("Invalid reasoning option");
			}
			return {
				reasoningEffort: effort.reasoningEffort,
				description: effort.description,
			};
		},
	);
	const inputModalities = entry.inputModalities.map((modality: unknown) => {
		const matchesModality =
			modality !== "text" && modality !== "image" && modality !== "audio";
		if (matchesModality) {
			throw new Error("Invalid modality");
		}
		return modality;
	});
	const serviceTiers = entry.serviceTiers.map(parseServiceTier);
	return {
		model: entry.model,
		displayName: entry.displayName,
		defaultReasoningEffort: entry.defaultReasoningEffort,
		supportedReasoningEfforts,
		inputModalities,
		serviceTiers,
	};
}

/** モデルのサービス階層は表示に使う属性を全て検証してから返す。 */
function parseServiceTier(tier: unknown): ModelInfo["serviceTiers"][number] {
	if (!isRecord(tier)) {
		throw new Error("Invalid service tier");
	}
	if (typeof tier.id !== "string") {
		throw new Error("Invalid service tier");
	}
	if (typeof tier.name !== "string") {
		throw new Error("Invalid service tier");
	}
	if (typeof tier.description !== "string") {
		throw new Error("Invalid service tier");
	}
	return { id: tier.id, name: tier.name, description: tier.description };
}

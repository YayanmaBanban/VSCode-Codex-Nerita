// アカウント・モデル一覧の応答から、UIに必要な検証済み情報だけを取り出す。
import type { Model } from "../codex-app-server/v2/Model";
import type { LoginAccountResponse } from "../codex-app-server/v2/LoginAccountResponse";
import { isRecord } from "../../../../shared/validation";

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
	if (
		!isRecord(value) ||
		!Array.isArray(value.data) ||
		!(value.nextCursor === null || typeof value.nextCursor === "string")
	) {
		throw new Error("Invalid model catalog");
	}
	const data = value.data.map((entry: unknown): ModelInfo => {
		if (
			!isRecord(entry) ||
			typeof entry.model !== "string" ||
			typeof entry.displayName !== "string" ||
			!isEffort(entry.defaultReasoningEffort) ||
			!Array.isArray(entry.supportedReasoningEfforts) ||
			!Array.isArray(entry.inputModalities) ||
			!Array.isArray(entry.serviceTiers)
		) {
			throw new Error("Invalid model");
		}
		const supportedReasoningEfforts = entry.supportedReasoningEfforts.map(
			(effort: unknown) => {
				if (
					!isRecord(effort) ||
					!isEffort(effort.reasoningEffort) ||
					typeof effort.description !== "string"
				) {
					throw new Error("Invalid reasoning option");
				}
				return {
					reasoningEffort: effort.reasoningEffort,
					description: effort.description,
				};
			},
		);
		const inputModalities = entry.inputModalities.map(
			(modality: unknown) => {
				if (
					modality !== "text" &&
					modality !== "image" &&
					modality !== "audio"
				) {
					throw new Error("Invalid modality");
				}
				return modality;
			},
		);
		const serviceTiers = entry.serviceTiers.map((tier: unknown) => {
			if (
				!isRecord(tier) ||
				typeof tier.id !== "string" ||
				typeof tier.name !== "string" ||
				typeof tier.description !== "string"
			) {
				throw new Error("Invalid service tier");
			}
			return {
				id: tier.id,
				name: tier.name,
				description: tier.description,
			};
		});
		return {
			model: entry.model,
			displayName: entry.displayName,
			defaultReasoningEffort: entry.defaultReasoningEffort,
			supportedReasoningEfforts,
			inputModalities,
			serviceTiers,
		};
	});
	return { data, nextCursor: value.nextCursor };
}
/** クライアントが開始する二つの認証方式だけを検証する。 */
export function parseLogin(
	value: unknown,
): Extract<LoginAccountResponse, { type: "chatgpt" | "apiKey" }> {
	if (!isRecord(value)) {
		throw new Error("Invalid login response");
	}
	if (value.type === "apiKey") {
		return { type: "apiKey" };
	}
	if (
		value.type === "chatgpt" &&
		typeof value.loginId === "string" &&
		typeof value.authUrl === "string"
	) {
		return {
			type: "chatgpt",
			loginId: value.loginId,
			authUrl: value.authUrl,
		};
	}
	throw new Error("Invalid login response");
}

// live catalogの未知schemaを拒否し、既知の推論能力だけ正規化する。
import { isRecord } from "../../../../shared/validation";
import { piThinkingLevels } from "../../../../shared/piProviderControls";
import type { PiCatalogModel } from "../PiModelCatalog";

/** wire値noneだけをoffへ写し、persistent等の未知値は無視する。 */
function reasoning(value: unknown): PiCatalogModel["defaultReasoning"] {
	if (value === "none") {
		return "off";
	}
	if (value === "ultra") {
		return value;
	}
	return (
		piThinkingLevels.find((level) => level !== "off" && level === value) ??
		null
	);
}

/** 部分的に壊れた一覧を成功扱いせず、最後に成功したcatalogを維持する。 */
export function normalizeCodexModels(
	payload: unknown,
): PiCatalogModel[] | null {
	if (!isRecord(payload) || !Array.isArray(payload.models)) {
		return null;
	}
	const models: PiCatalogModel[] = [];
	const seen = new Set<string>();
	for (const item of payload.models) {
		const model = normalizeModel(item, seen);
		if (!model) {
			return null;
		}
		models.push(model);
	}
	return models.sort((left, right) => left.priority - right.priority);
}

/** 一つのモデルの必須値と推論・サービス候補を検証する。 */
function normalizeModel(
	item: unknown,
	seen: Set<string>,
): PiCatalogModel | null {
	if (
		!isModelIdentity(item) ||
		seen.has(item.slug) ||
		!["list", "hide", "none"].includes(String(item.visibility)) ||
		!Array.isArray(item.supported_reasoning_levels) ||
		!validModelMetadata(item)
	) {
		return null;
	}
	const levels = normalizeReasoningLevels(item.supported_reasoning_levels);
	const tiers = normalizeServiceTiers(item.service_tiers);
	if (!levels || !tiers) {
		return null;
	}
	seen.add(item.slug);
	return {
		slug: item.slug,
		displayName: item.display_name,
		priority: item.priority,
		visibility: item.visibility as PiCatalogModel["visibility"],
		defaultReasoning: reasoning(item.default_reasoning_level),
		reasoningLevels: levels,
		serviceTiers: tiers,
	};
}

/** カタログでの識別子・表示名・並び順を検証する。 */
function isModelIdentity(item: unknown): item is Record<string, unknown> & {
	slug: string;
	display_name: string;
	priority: number;
} {
	return (
		isRecord(item) &&
		typeof item.slug === "string" &&
		item.slug.length > 0 &&
		typeof item.display_name === "string" &&
		item.display_name.length > 0 &&
		typeof item.priority === "number" &&
		Number.isFinite(item.priority)
	);
}

/** 任意の推論既定値とサービス候補の外形を検証する。 */
function validModelMetadata(item: Record<string, unknown>): boolean {
	return (
		(item.default_reasoning_level === null ||
			item.default_reasoning_level === undefined ||
			typeof item.default_reasoning_level === "string") &&
		(item.service_tiers === undefined || Array.isArray(item.service_tiers))
	);
}

/** 対応する推論レベルを重複なく集める。 */
function normalizeReasoningLevels(
	entries: unknown[],
): PiCatalogModel["reasoningLevels"] | null {
	const levels: PiCatalogModel["reasoningLevels"] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.effort !== "string") {
			return null;
		}
		const level = reasoning(entry.effort);
		if (level && !levels.includes(level)) {
			levels.push(level);
		}
	}
	return levels;
}

/** サービス候補を検証し、未指定は空の一覧として扱う。 */
function normalizeServiceTiers(
	value: unknown,
): PiCatalogModel["serviceTiers"] | null {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return null;
	}
	const tiers: PiCatalogModel["serviceTiers"] = [];
	for (const tier of value) {
		if (
			!isRecord(tier) ||
			typeof tier.id !== "string" ||
			typeof tier.name !== "string" ||
			typeof tier.description !== "string"
		) {
			return null;
		}
		tiers.push({
			id: tier.id,
			name: tier.name,
			description: tier.description,
		});
	}
	return tiers;
}

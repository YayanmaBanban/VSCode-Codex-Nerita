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
		if (
			!isRecord(item) ||
			typeof item.slug !== "string" ||
			!item.slug ||
			seen.has(item.slug) ||
			typeof item.display_name !== "string" ||
			!item.display_name ||
			typeof item.priority !== "number" ||
			!Number.isFinite(item.priority) ||
			!["list", "hide", "none"].includes(String(item.visibility)) ||
			!Array.isArray(item.supported_reasoning_levels) ||
			(item.default_reasoning_level !== null &&
				item.default_reasoning_level !== undefined &&
				typeof item.default_reasoning_level !== "string") ||
			(item.service_tiers !== undefined &&
				!Array.isArray(item.service_tiers))
		) {
			return null;
		}
		const levels: PiCatalogModel["reasoningLevels"] = [];
		for (const entry of item.supported_reasoning_levels) {
			if (!isRecord(entry) || typeof entry.effort !== "string") {
				return null;
			}
			const level = reasoning(entry.effort);
			if (level && !levels.includes(level)) {
				levels.push(level);
			}
		}
		const tiers: PiCatalogModel["serviceTiers"] = [];
		for (const tier of item.service_tiers ?? []) {
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
		seen.add(item.slug);
		models.push({
			slug: item.slug,
			displayName: item.display_name,
			priority: item.priority,
			visibility: item.visibility as PiCatalogModel["visibility"],
			defaultReasoning: reasoning(item.default_reasoning_level),
			reasoningLevels: levels,
			serviceTiers: tiers,
		});
	}
	return models.sort((a, b) => a.priority - b.priority);
}

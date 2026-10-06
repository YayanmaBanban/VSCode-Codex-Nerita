// ChatGPT の公開モデル一覧から表示情報と Ultra の対応・実推論値を取り出す。
import { isRecord } from "@nerita/shared/validation";
import { piThinkingLevels } from "@nerita/shared/piProviderControls";
import type { PiCatalogModel } from "../PiModelCatalog";

/** 通常の API キー用一覧や旧カタログの推論・サービス情報を混用しない。 */
export function normalizeOpenAIModels(
	payload: unknown,
): PiCatalogModel[] | null {
	if (
		!isRecord(payload) ||
		!Array.isArray(payload.models) ||
		payload.models.length > 1000
	) {
		return null;
	}
	const result: PiCatalogModel[] = [];
	const seen = new Set<string>();
	for (const [priority, item] of payload.models.entries()) {
		if (!isModelIdentity(item) || seen.has(item.slug)) {
			return null;
		}
		seen.add(item.slug);
		const ultraEffort = resolveUltraEffort(item);
		result.push({
			slug: item.slug,
			displayName: item.display_name,
			priority,
			visibility: item.visibility as PiCatalogModel["visibility"],
			...(ultraEffort !== undefined ? { ultraEffort } : {}),
			...(supportsPriority(item.service_tiers) ? { fastMode: true } : {}),
		});
	}
	return result;
}

/** 新 OAuth で送信を確認した priority を明示するモデルだけに Fast を公開する。 */
function supportsPriority(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.length <= 32 &&
		value.every((entry) => isRecord(entry) && isShortText(entry.id)) &&
		value.some(
			(entry: unknown) => isRecord(entry) && entry.id === "priority",
		)
	);
}

/** Ultra の明示がある場合だけ、委譲用推論レベル・max・最後の通常候補の順で解決する。 */
function resolveUltraEffort(
	item: Record<string, unknown>,
): PiCatalogModel["ultraEffort"] {
	const entries = item.supported_reasoning_levels;
	if (!validReasoningEntries(entries)) {
		return undefined;
	}
	if (!entries.some((entry) => entry.effort === "ultra")) {
		return undefined;
	}
	const levels = entries.flatMap((entry) => {
		const level = piThinkingLevels.find(
			(value) => value !== "off" && value === entry.effort,
		);
		return level !== undefined ? [level] : [];
	});
	const preferred = levels.find(
		(level) => level === item.multi_agent_reasoning_effort,
	);
	return (
		preferred ?? levels.find((level) => level === "max") ?? levels.at(-1)
	);
}

/** 不正・巨大な能力欄を使わず、基本のモデル一覧は利用できるようにする。 */
function validReasoningEntries(value: unknown): value is { effort: string }[] {
	return (
		Array.isArray(value) &&
		value.length <= 32 &&
		value.every((entry) => isRecord(entry) && isShortText(entry.effort))
	);
}

/** 識別子と名前を短い文字列に限定し、未知の公開状態を拒否する。 */
function isModelIdentity(
	item: unknown,
): item is Record<string, unknown> & { slug: string; display_name: string } {
	return (
		isRecord(item) &&
		isShortText(item.slug) &&
		isShortText(item.display_name) &&
		["list", "hide", "none"].includes(String(item.visibility))
	);
}

/** カタログ由来の表示文字列へ上限を設ける。 */
function isShortText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

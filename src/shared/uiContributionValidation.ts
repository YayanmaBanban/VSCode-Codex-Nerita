// 宣言型UIの通信境界で、種別・候補・数値・重複IDを検証する。
import { isBackendId } from "./backend";
import { isId, isRecord } from "./validation";
import type { UiContributions } from "./uiContributions";
import { validComposerField } from "./composerValidation";

/** 説明文は省略可能なプレーンテキストに限定する。 */
function description(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

/** 対応するcontrolだけを受け入れる。 */
function control(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
		return false;
	}
	if (!description(value.description)) {
		return false;
	}
	if (value.type === "quota") {
		return (
			Array.isArray(value.windows) &&
			validComposerField("quota", value.windows)
		);
	}
	if (value.type === "select") {
		const option = value.option;
		return (
			isRecord(option) &&
			isId(option.id) &&
			typeof option.name === "string" &&
			typeof option.currentValue === "string" &&
			description(option.description) &&
			Array.isArray(option.options) &&
			option.options.every(
				(item: unknown) =>
					isRecord(item) &&
					isId(item.value) &&
					typeof item.name === "string" &&
					description(item.description),
			) &&
			new Set(option.options.map((item: { value: string }) => item.value))
				.size === option.options.length
		);
	}
	if (value.type === "toggle") {
		return (
			isId(value.configId) &&
			typeof value.label === "string" &&
			typeof value.checked === "boolean" &&
			isId(value.onValue) &&
			isId(value.offValue) &&
			value.onValue !== value.offValue
		);
	}
	return (
		value.type === "progress" &&
		typeof value.label === "string" &&
		typeof value.value === "number" &&
		Number.isFinite(value.value) &&
		value.value >= 0 &&
		value.value <= 100
	);
}

/** 未解決条件や未知のcontrolを含むスナップショット・差分を拒否する。 */
export function isUiContributions(value: unknown): value is UiContributions {
	if (
		!isRecord(value) ||
		!isBackendId(value.surface) ||
		!Array.isArray(value.items)
	) {
		return false;
	}
	const ids = new Set<string>();
	return value.items.every((item: unknown) => {
		if (
			!isRecord(item) ||
			!isId(item.id) ||
			ids.has(item.id) ||
			item.when !== undefined ||
			![
				"settings.main",
				"settings.advanced",
				"model.header",
				"composer.toolbar",
				"status",
			].includes(String(item.slot)) ||
			(item.order !== undefined &&
				(typeof item.order !== "number" ||
					!Number.isFinite(item.order))) ||
			!control(item.control)
		) {
			return false;
		}
		ids.add(item.id);
		return true;
	});
}

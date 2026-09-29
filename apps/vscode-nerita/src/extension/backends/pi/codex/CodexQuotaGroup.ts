// Codex の利用枠表示を引き継げるモデル群を定義する。

/** Spark を別枠とし、Luna・Astra を含む通常モデルは同じ枠として扱う。 */
export function codexQuotaGroup(modelId: string): string {
	return /(?:^|[-_])spark(?:$|[-_])/i.test(modelId) ? "spark" : "standard";
}

// プロバイダー名を React へ判断させず、Host の現在の文脈で表示条件を解決する。
import type { BackendId } from "@nerita/shared/backend";
import type { ContributionCondition } from "@nerita/shared/uiContributions";

/** バックエンドとは独立したプロバイダーと、Host が確認した能力。 */
export type ContributionContext = {
	backend: BackendId;
	provider: string | null;
	capabilities: readonly string[];
};

/** 指定された条件は AND で評価し、不明な能力は表示しない。 */
export function matchesContribution(
	condition: ContributionCondition | undefined,
	context: ContributionContext,
): boolean {
	if (!condition) {
		return true;
	}
	if (!(
		condition.backend === undefined || condition.backend === context.backend
	)) {
		return false;
	}
	if (!(
		condition.provider === undefined ||
		condition.provider === context.provider
	)) {
		return false;
	}
	return (
		condition.capability === undefined ||
		context.capabilities.includes(condition.capability)
	);
}

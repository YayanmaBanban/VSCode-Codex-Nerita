// プロバイダー名を React へ判断させず、Host の現在の文脈で表示条件を解決する。
import type { BackendId } from "../../shared/backend";
import type { ContributionCondition } from "../../shared/uiContributions";

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
	return (
		!condition ||
		((condition.backend === undefined ||
			condition.backend === context.backend) &&
			(condition.provider === undefined ||
				condition.provider === context.provider) &&
			(condition.capability === undefined ||
				context.capabilities.includes(condition.capability)))
	);
}

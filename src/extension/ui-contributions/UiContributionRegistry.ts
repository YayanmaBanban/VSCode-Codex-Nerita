// 内部の登録元を集約し、現在の状態に応じた宣言だけを公開する。
import type { ChatState } from "../../shared/chatState";
import type {
	NeritaUiContribution,
	UiContributions,
} from "../../shared/uiContributions";
import { isUiContributions } from "../../shared/uiContributionValidation";
import {
	matchesContribution,
	type ContributionContext,
} from "./contributionConditions";

/** 状態更新ごとに候補や現在値を再計算する内部登録元。 */
export type UiContributionSource = (
	state: Readonly<ChatState>,
	context: ContributionContext,
) => readonly NeritaUiContribution[];

/** 重複登録を拒否し、解除をセッションの寿命に結び付けられる Registry。 */
export class UiContributionRegistry {
	private sources = new Map<string, UiContributionSource>();

	/** 登録解除は一度だけ効き、同名の後続登録を消さない。 */
	registerUiContribution(
		id: string,
		source: UiContributionSource,
	): () => void {
		if (this.sources.has(id)) {
			throw new Error(`UI Contribution already registered: ${id}`);
		}
		this.sources.set(id, source);
		let active = true;
		return () => {
			if (active) {
				this.sources.delete(id);
			}
			active = false;
		};
	}

	/** 条件を除去し、同順位は ID 順にして安定した表示を作る。 */
	resolve(
		state: Readonly<ChatState>,
		context: ContributionContext,
	): UiContributions {
		const items = [...this.sources.values()]
			.flatMap((source) => [...source(state, context)])
			.filter((item) => matchesContribution(item.when, context))
			.map(({ when: _when, ...item }) => item)
			.sort(
				(a, b) =>
					(a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
			);
		const result = { surface: context.backend, items };
		if (!isUiContributions(result)) {
			throw new Error("Invalid UI Contribution");
		}
		return structuredClone(result);
	}
}

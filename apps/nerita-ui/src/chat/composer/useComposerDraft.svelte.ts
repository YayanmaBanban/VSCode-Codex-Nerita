// 参照を含む入力の下書きを保持し、Host からの復元と保存要求を同期する。
import type { Bridge } from "@nerita/shared/bridge";

import type { ComposerPart } from "@nerita/shared/composerContent";

/** 外部からの文字列の復元や消去にも、編集可能な通常文を1つ用意する。 */
const textPart = (text: string): ComposerPart => ({
	id: crypto.randomUUID(),
	type: "text",
	text,
});
/** 参照を含む下書きを Host と同期する。Svelte の寿命管理内で呼び出し、接続の交換は最新値を参照できるようにする。 */
export function useComposerDraft(input: { bridge: Bridge }) {
	const bridge = $derived(input.bridge);

	let parts = $state.raw<ComposerPart[]>((() => [textPart("")])());
	/** 文字列と参照からなる下書きの部品を更新し、外部復元でも同じ状態へ反映する。 */
	const updateDraft = (
		value: typeof parts | ((previous: typeof parts) => typeof parts),
	) => {
		parts = typeof value === "function" ? value(parts) : value;
	};
	// Bridge の交換に合わせて下書き復元の購読を張り替え、画面の破棄で解除する。
	$effect(() =>
		bridge.subscribe((message) => {
			if (message.type === "ui/viewState") {
				updateDraft(message.draftParts ?? [textPart(message.draft)]);
			}
		}),
	);
	/** 文字列の入力を通常の本文部品へ変換し、表示状態と Host の保存内容を同時に更新する。 */
	const setDraft = (value: string | ComposerPart[]) => {
		const next = typeof value === "string" ? [textPart(value)] : value;
		updateDraft(next);
		bridge.postMessage({
			type: "ui/saveDraft",
			requestId: crypto.randomUUID(),
			draft: next.map((part) => part.text).join(""),
			draftParts: next,
		});
	};
	return {
		get parts() {
			return parts;
		},
		get draft() {
			return parts.map((part) => part.text).join("");
		},
		setDraft,
	};
}

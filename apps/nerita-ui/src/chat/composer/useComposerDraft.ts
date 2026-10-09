// 下書きを入力欄の領域で保持し、編集ごとに会話一覧や接続ヘッダーを更新しない。
import { useCallback, useEffect, useState } from "react";
import type { Bridge } from "@nerita/shared/bridge";
import type { ComposerPart } from "@nerita/shared/composerContent";

/** 外部からの文字列の復元や消去にも、編集可能な通常文を1つ用意する。 */
const textPart = (text: string): ComposerPart => ({
	id: crypto.randomUUID(),
	type: "text",
	text,
});

/** 入力をその場で保持し、表示先の移動に備えて Host へ最新の断片を保存する。 */
export function useComposerDraft(bridge: Bridge) {
	const [parts, updateDraft] = useState<ComposerPart[]>(() => [textPart("")]);
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (message.type === "ui/viewState") {
					updateDraft(
						message.draftParts ?? [textPart(message.draft)],
					);
				}
			}),
		[bridge],
	);
	const setDraft = useCallback(
		(value: string | ComposerPart[]) => {
			const next = typeof value === "string" ? [textPart(value)] : value;
			updateDraft(next);
			bridge.postMessage({
				type: "ui/saveDraft",
				requestId: crypto.randomUUID(),
				draft: next.map((part) => part.text).join(""),
				draftParts: next,
			});
		},
		[bridge],
	);
	return { parts, draft: parts.map((part) => part.text).join(""), setDraft };
}

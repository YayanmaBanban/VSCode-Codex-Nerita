// 作成・選択の応答を待つ間は旧 Intent の操作を隠し、失敗時は入力を保持する。
import { useEffect, useState } from "react";
import type { Bridge } from "@nerita/shared/bridge";
import type { DlcAction, DlcView } from "@nerita/shared/dlc/contracts";
import { useDlc } from "./useDlc";
import { useDlcEditor } from "./useDlcEditor";
import { currentPhase } from "./DlcPhases";

export function useDlcWorkspace(bridge: Bridge) {
	const view = useDlc(bridge);
	const editor = useDlcEditor(bridge);
	const creation = useIntentCreation(bridge, view);
	const [selecting, setSelecting] = useState<string | null>(null);
	const newIntent = creation.creating || view.intents.length === 0;
	const waiting = selecting !== null && selecting !== view.selected?.intentId;
	const selected = newIntent || waiting ? null : view.selected;
	useEffect(() => {
		if (selecting === view.selected?.intentId || view.error !== null) {
			setSelecting(null);
		}
	}, [selecting, view.selected?.intentId, view.error]);
	const expanded = selected
		? (editor.state.expanded[selected.intentId] ?? [currentPhase(selected)])
		: [0];
	return {
		view,
		editor,
		creation,
		newIntent,
		selected,
		expanded,
		send: bridge.postMessage,
		select(this: void, intentId: string) {
			creation.setCreating(false);
			setSelecting(intentId);
			bridge.postMessage({
				type: "dlc/select",
				requestId: crypto.randomUUID(),
				intentId,
			});
		},
		action(this: void, action: DlcAction) {
			if (selected) {
				bridge.postMessage({
					type: "dlc/action",
					requestId: crypto.randomUUID(),
					intentId: selected.intentId,
					revision: selected.revision,
					action,
				});
			}
		},
		toggle(this: void, phase: number) {
			if (selected) {
				editor.toggle(selected.intentId, phase, expanded);
			}
		},
	};
}

function useIntentCreation(bridge: Bridge, view: DlcView) {
	const [creating, setCreating] = useState(false);
	const [pending, setPending] = useState<{
		requestId: string;
		existing: string[];
	} | null>(null);
	useEffect(() => {
		if (
			pending &&
			view.selected &&
			!pending.existing.includes(view.selected.intentId)
		) {
			setPending(null);
			setCreating(false);
		}
	}, [view.selected, pending]);
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (
					message.type === "request/failed" &&
					message.requestId === pending?.requestId
				) {
					setPending(null);
				}
			}),
		[bridge, pending],
	);
	return {
		creating,
		setCreating,
		pending: pending !== null,
		submit(this: void, requestId: string) {
			setPending({
				requestId,
				existing: view.intents.map((intent) => intent.intentId),
			});
		},
	};
}

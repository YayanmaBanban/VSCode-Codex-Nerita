// Intent の一覧と操作状態だけを購読し、会話の逐次表示は既存のチャット購読に任せる。
import { useEffect, useState } from "react";
import type { Bridge } from "@nerita/shared/bridge";
import type { DlcView } from "@nerita/shared/dlc/contracts";

export function useDlc(bridge: Bridge): DlcView {
	const [view, setView] = useState<DlcView>({
		mode: "chat",
		backend: "codex",
		intents: [],
		environment: null,
		selected: null,
		error: null,
		active: null,
		execution: null,
	});
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (message.type === "dlc/state") {
					setView(message.view);
				}
			}),
		[bridge],
	);
	return view;
}

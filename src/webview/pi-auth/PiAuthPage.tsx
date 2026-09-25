// 認証専用パネルの通信をチャット Bridge から分離する。
import { useEffect, useState } from "react";
import {
	isPiAuthState,
	type PiAuthState,
	type PiAuthRequest,
} from "../../shared/piAuth";
import { PiAuthEditor } from "./PiAuthEditor";

/** 秘密入力を VS Code の保存状態に書き込まない。 */
export function PiAuthPage({
	post,
}: {
	post: (request: PiAuthRequest) => void;
}) {
	const [state, setState] = useState<PiAuthState>({
		items: [],
		active: null,
		prompt: null,
		notice: "読み込み中…",
		error: null,
	});
	useEffect(() => {
		const receive = (event: MessageEvent<unknown>) => {
			if (isPiAuthState(event.data)) {
				setState(event.data);
			}
		};
		window.addEventListener("message", receive);
		post({ type: "ready" });
		return () => window.removeEventListener("message", receive);
	}, [post]);
	return <PiAuthEditor state={state} send={post} />;
}

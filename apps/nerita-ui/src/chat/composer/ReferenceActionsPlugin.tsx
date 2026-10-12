// チップの開く操作を Lexical から Host へ渡し、URI の実行判断は Host へ任せる。
import { useEffect } from "react";
import { createCommand, COMMAND_PRIORITY_EDITOR } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Bridge } from "@nerita/shared/bridge";
import type { ComposerTarget } from "@nerita/shared/composerTargets";

/** 参照ノードの表示と、画面ごとの通信実装を分離する。 */
export const OPEN_REFERENCE_COMMAND =
	createCommand<ComposerTarget>("open-reference");

/** 表示先の Bridge で参照を開き、アンマウント時にコマンドを解除する。 */
export function ReferenceActionsPlugin({
	bridge,
}: {
	bridge: Bridge | undefined;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		/** 参照の種別ごとに Host へ開く要求を渡し、パスの実行判断は Host に任せる。 */
		const openComposerReference = (path: ComposerTarget) => {
			if (!bridge) {
				return false;
			}
			if (path.kind === "changes") {
				bridge.postMessage({
					type: "changes/open",
					requestId: crypto.randomUUID(),
					scope: path.scope,
				});
				return true;
			}
			if (path.kind === "session") {
				bridge.postMessage({
					type: "session/openReference",
					requestId: crypto.randomUUID(),
					referencedSessionId: path.sessionId,
				});
				return true;
			}
			const range = path.range ?? path.symbol?.range;
			bridge.postMessage({
				type: "reference/open",
				requestId: crypto.randomUUID(),
				uri: path.uri,
				...(range ? { range } : {}),
			});
			return true;
		};
		return editor.registerCommand(
			OPEN_REFERENCE_COMMAND,
			openComposerReference,
			COMMAND_PRIORITY_EDITOR,
		);
	}, [editor, bridge]);
	return null;
}

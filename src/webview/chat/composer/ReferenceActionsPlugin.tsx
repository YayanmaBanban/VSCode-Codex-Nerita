// チップの開く操作をLexicalからHostへ渡し、URIの実行判断はHostへ任せる。
import { useEffect } from "react";
import { createCommand, COMMAND_PRIORITY_EDITOR } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Bridge } from "../../vscodeBridge";
import type { ComposerTarget } from "../../../shared/composerTargets";

/** 参照ノードの表示と、画面ごとの通信実装を分離する。 */
export const OPEN_REFERENCE_COMMAND =
	createCommand<ComposerTarget>("open-reference");

/** 表示先のBridgeで参照を開き、アンマウント時にコマンドを解除する。 */
export function ReferenceActionsPlugin({
	bridge,
}: {
	bridge: Bridge | undefined;
}) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerCommand(
				OPEN_REFERENCE_COMMAND,
				(path) => {
					if (!bridge) {
						return false;
					}
					if (path.kind === "session") {
						bridge.postMessage({
							type: "session/openReference",
							requestId: crypto.randomUUID(),
							referencedSessionId: path.sessionId,
						});
						return true;
					}
					bridge.postMessage({
						type: "reference/open",
						requestId: crypto.randomUUID(),
						uri: path.uri,
						...(path.symbol ? { range: path.symbol.range } : {}),
					});
					return true;
				},
				COMMAND_PRIORITY_EDITOR,
			),
		[editor, bridge],
	);
	return null;
}

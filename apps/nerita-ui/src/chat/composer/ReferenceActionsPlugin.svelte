<!-- 入力欄の参照を開くコマンドを登録し、参照の種類に応じた要求を Host へ送る。 -->
<script module lang="ts">
	import { createCommand, COMMAND_PRIORITY_EDITOR } from "lexical";
	import type { ComposerTarget } from "@nerita/shared/composerTargets";

	export const OPEN_REFERENCE_COMMAND =
		createCommand<ComposerTarget>("open-reference");
</script>

<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import { getLexicalEditor } from "./lexicalContext";

	let { bridge }: { bridge: Bridge | undefined } = $props();

	const editor = getLexicalEditor();

	// 参照を開く操作を Lexical に登録し、入力欄の破棄時にコマンドを解除する。
	$effect(() => {
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
	});
</script>

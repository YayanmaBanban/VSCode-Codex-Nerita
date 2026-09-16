/// <reference lib="dom" />
// LexicalノードのDOM型を参照し、描画せずに下書き形式の往復を検証する。
import { describe, expect, it } from "vitest";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	createEditor,
} from "lexical";
import { PastedBlockNode } from "../../src/webview/chat/composer/PastedBlockNode";
import {
	$readParts,
	$writeParts,
	contentKey,
} from "../../src/webview/chat/composer/content";
import {
	validDraftParts,
	type ComposerPart,
} from "../../src/shared/composerContent";

describe("Lexical下書きの変換", () => {
	it("空の前後・複数ブロック・改行・タブを保存と復元で保持する", () => {
		const editor = createEditor({
			namespace: "composer-test",
			nodes: [PastedBlockNode],
			onError: (error) => {
				throw error;
			},
		});
		const parts: ComposerPart[] = [
			{ id: "1", type: "text", text: "" },
			{ id: "2", type: "pasted", text: "\n\tconst a = 1;\n" },
			{ id: "3", type: "text", text: "\n間の文章\n" },
			{ id: "4", type: "pasted", text: "\n" },
			{ id: "5", type: "text", text: "" },
		];
		editor.update(() => $writeParts(parts), { discrete: true });
		const restored = editor.getEditorState().read($readParts);
		expect(contentKey(restored)).toBe(contentKey(parts));
		expect(
			validDraftParts(parts.map((part) => part.text).join(""), restored),
		).toBe(true);
		const json = JSON.stringify(editor.getEditorState());
		editor.setEditorState(editor.parseEditorState(json));
		expect(
			editor.getEditorState().read(() => contentKey($readParts())),
		).toBe(contentKey(parts));
	});
	it("通常段落が複数ある場合は改行でまとめる", () => {
		const editor = createEditor({
			onError: (error) => {
				throw error;
			},
		});
		editor.update(
			() => {
				$getRoot().append(
					$createParagraphNode().append($createTextNode("前")),
					$createParagraphNode().append($createTextNode("後")),
				);
			},
			{ discrete: true },
		);
		expect(editor.getEditorState().read($readParts)[0]?.text).toBe(
			"前\n後",
		);
	});
});

// 性格設定の本文を、履歴とプレーンテキスト貼り付けに対応するLexicalで編集する。
import { useEffect, useId } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

/** 保存中やconfig.toml優先時の編集可否を同期する。 */
function EditablePlugin({ disabled }: { disabled: boolean }) {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		editor.setEditable(!disabled);
	}, [editor, disabled]);
	return null;
}

/** 外部のプリセット切替は親のkeyで再初期化し、入力中の選択範囲を保つ。 */
export function InstructionEditor({
	text,
	disabled,
	label,
	onChange,
}: {
	text: string;
	disabled: boolean;
	label: string;
	onChange: (text: string) => void;
}) {
	const helpId = useId();
	return (
		<div className="min-w-0">
			<LexicalComposer
				initialConfig={{
					namespace: "personality",
					editable: !disabled,
					theme: {
						paragraph:
							"m-0 min-h-[1.7em] whitespace-pre-wrap [overflow-wrap:anywhere]",
					},
					editorState: () => {
						$getRoot().append(
							$createParagraphNode().append(
								$createTextNode(text),
							),
						);
					},
					onError: (error) => {
						throw error;
					},
				}}
			>
				<PlainTextPlugin
					contentEditable={
						<ContentEditable
							aria-label={label}
							aria-describedby={helpId}
							aria-readonly={disabled}
							className="min-h-[120px] max-h-[240px] overflow-y-auto rounded-[6px] border border-solid border-input-border bg-input p-[10px] text-input-text leading-[1.7] focus-visible:outline-2 focus-visible:outline-focus"
						/>
					}
					ErrorBoundary={LexicalErrorBoundary}
				/>
				<HistoryPlugin />
				<EditablePlugin disabled={disabled} />
				<OnChangePlugin
					ignoreSelectionChange
					onChange={(state) =>
						state.read(() => onChange($getRoot().getTextContent()))
					}
				/>
			</LexicalComposer>
			<p
				id={helpId}
				className="mb-0 mt-[6px] text-[11px] text-muted leading-[1.7]"
			>
				ルールや性格を記載する場所です。使用させたいコマンドなどは、AGENTS.md
				に記載してください。
			</p>
		</div>
	);
}

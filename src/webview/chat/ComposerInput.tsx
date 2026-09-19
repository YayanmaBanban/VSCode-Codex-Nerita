// 通常文と編集可能な貼り付けブロックを、一つのLexicalフィールドとして表示する。
import { useId, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import type { ComposerPart } from "../../shared/composerContent";
import { PastedBlockNode } from "./composer/PastedBlockNode";
import { PathReferenceNode } from "./composer/PathReferenceNode";
import { ReferenceActionsPlugin } from "./composer/ReferenceActionsPlugin";
import { ComposerPlugin } from "./composer/ComposerPlugin";
import { CodeBlockMenuPlugin } from "./composer/CodeBlockMenuPlugin";
import { $writeParts } from "./composer/content";
import { CompletionPlugin } from "./composer/CompletionPlugin";
import type { Attachment } from "../../shared/composer";
import type { SkillSummary } from "../../shared/skills";
import type { Bridge } from "../vscodeBridge";

/** 全体のスクロールを一本にまとめ、コード領域だけ内部スクロールを許可する。 */
export function ComposerInput({
	bridge,
	parts,
	onChange,
	onSubmit,
	locked = false,
	followUp = false,
	attachments = [],
	skills = [],
	completionScope = "",
}: {
	bridge?: Bridge | undefined;
	parts: ComposerPart[];
	onChange: (parts: ComposerPart[]) => void;
	onSubmit: () => void;
	locked?: boolean;
	followUp?: boolean;
	attachments?: Attachment[];
	skills?: SkillSummary[];
	completionScope?: string;
}) {
	const [error, setError] = useState("");
	const [expanded, setExpanded] = useState(false);
	const inputId = useId();
	return (
		<LexicalComposer
			initialConfig={{
				namespace: "codex-composer",
				nodes: [PastedBlockNode, PathReferenceNode],
				theme: {
					paragraph:
						"m-0 min-h-[1.7em] whitespace-pre-wrap [overflow-wrap:anywhere]",
				},
				editorState: () => $writeParts(parts),
				onError: (cause) => {
					throw cause;
				},
			}}
		>
			<div className="flex items-start gap-2">
				<div className="relative min-w-0 flex-1">
					<CompletionPlugin
						key={completionScope}
						bridge={bridge}
						attachments={attachments}
						skills={skills}
					/>
					<PlainTextPlugin
						contentEditable={
							<ContentEditable
								id={inputId}
								aria-label="Codexへのメッセージ"
								aria-describedby="composer-help"
								aria-disabled={locked}
								spellCheck={false}
								className={`composer-content min-h-[65px] overflow-y-auto overscroll-y-contain p-1 text-input-text leading-[1.7] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-focus ${expanded ? "h-[min(65dvh,calc(100dvh-300px))]" : "max-h-[min(360px,45vh)]"}`}
							/>
						}
						placeholder={
							<span className="pointer-events-none absolute top-1 left-1 text-input-placeholder">
								{followUp
									? "フォローアップを送信"
									: "Codexに依頼する…"}
							</span>
						}
						ErrorBoundary={LexicalErrorBoundary}
					/>
				</div>
				<button
					type="button"
					className="flex h-7 w-7 shrink-0 items-center justify-center border-0 bg-transparent p-1 text-muted hover:text-input-text"
					aria-label={
						expanded
							? "入力エリアを元のサイズに戻す"
							: "入力エリアを拡張"
					}
					title={
						expanded
							? "入力エリアを元のサイズに戻す"
							: "入力エリアを拡張"
					}
					aria-expanded={expanded}
					aria-controls={inputId}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? (
						<Minimize2 size={16} aria-hidden="true" />
					) : (
						<Maximize2 size={16} aria-hidden="true" />
					)}
				</button>
			</div>
			<HistoryPlugin />
			<CodeBlockMenuPlugin bridge={bridge} />
			<ReferenceActionsPlugin bridge={bridge} />
			<ComposerPlugin
				locked={locked}
				parts={parts}
				onChange={onChange}
				onSubmit={onSubmit}
				onError={setError}
			/>
			{error && (
				<p role="alert" className="text-[12px] text-tool-error">
					{error}
				</p>
			)}
		</LexicalComposer>
	);
}

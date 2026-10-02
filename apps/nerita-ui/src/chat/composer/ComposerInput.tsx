// 通常文と編集可能な貼り付けブロックを、1つの Lexical フィールドとして表示する。

import { AutoLinkNode, LinkNode } from "@lexical/link";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import type { Bridge } from "@nerita/shared/bridge";
import type { Attachment } from "@nerita/shared/composer";
import type { ComposerPart } from "@nerita/shared/composerContent";
import type { SkillSummary } from "@nerita/shared/skills";
import { cn } from "cnfast";
import { Maximize2, Minimize2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useId, useState } from "react";
import { SettingsTooltip } from "../SettingsTooltip";
import { CodeBlockMenuPlugin } from "./CodeBlockMenuPlugin";
import { CompletionPlugin } from "./CompletionPlugin";
import { ComposerLinksPlugin } from "./ComposerLinksPlugin";
import { ComposerPlugin } from "./ComposerPlugin";
import { $writeParts } from "./content";
import { PastedBlockNode } from "./PastedBlockNode";
import { PathReferenceNode } from "./PathReferenceNode";
import { ReferenceActionsPlugin } from "./ReferenceActionsPlugin";

/** 下書きの構成要素、編集・送信操作と補完に使う候補・通信先。 */
type ComposerInputProps = {
	bridge?: Bridge | undefined;
	parts: ComposerPart[];
	onChange: (parts: ComposerPart[]) => void;
	onSubmit: () => void;
	locked?: boolean;
	followUp?: boolean;
	attachments?: Attachment[];
	skills?: SkillSummary[];
	completionScope?: string;
	collaborationModes?: boolean;
	contextRequest?: number | undefined;
	onAttach?: (() => void) | undefined;
};

/** 入力欄全体のスクロールを1つにまとめ、コード領域だけ内部スクロールを許可する。 */
export function ComposerInput(props: ComposerInputProps) {
	const {
		bridge,
		parts,
		locked = false,
		followUp = false,
		attachments = [],
		skills = [],
		completionScope = "",
		collaborationModes = false,
	} = props;
	const [error, setError] = useState("");
	const [expanded, setExpanded] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const inputId = useId();
	const helpId = `${inputId}-help`;
	return (
		<LexicalComposer
			initialConfig={{
				namespace: "codex-composer",
				nodes: [
					PastedBlockNode,
					PathReferenceNode,
					LinkNode,
					AutoLinkNode,
				],
				theme: {
					link: "cursor-text text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus",
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
						{...props}
						collaborationModes={collaborationModes}
						key={completionScope}
						attachments={attachments}
						skills={skills}
					/>
					<ComposerTextField
						inputId={inputId}
						helpId={helpId}
						setShowHelp={setShowHelp}
						locked={locked}
						expanded={expanded}
						followUp={followUp}
					/>
					<ComposerHelp helpId={helpId} showHelp={showHelp} />
				</div>
				{renderExpandButton(expanded, inputId, setExpanded)}
			</div>
			<HistoryPlugin />
			<ComposerLinksPlugin />
			<CodeBlockMenuPlugin bridge={bridge} />
			<ReferenceActionsPlugin bridge={bridge} />
			<ComposerPlugin {...props} locked={locked} onError={setError} />
			{error && (
				<p role="alert" className="text-[12px] text-tool-error">
					{error}
				</p>
			)}
		</LexicalComposer>
	);
}

/** 入力欄と操作案内の識別子、拡張・入力制限・追加指示の状態。 */
type ComposerTextFieldProps = {
	inputId: string;
	helpId: string;
	setShowHelp: Dispatch<SetStateAction<boolean>>;
	locked: boolean;
	expanded: boolean;
	followUp: boolean;
};

/** 入力操作の案内を表示する識別子と表示状態。 */
type ComposerHelpProps = {
	helpId: string;
	showHelp: boolean;
};

/** 入力操作の案内をフォーカス中だけ表示する。 */
function ComposerHelp({ helpId, showHelp }: ComposerHelpProps) {
	return (
		<span
			id={helpId}
			role="tooltip"
			hidden={!showHelp}
			className="absolute bottom-full left-0 z-30 mb-2 w-max max-w-full rounded-[6px] border border-solid border-tooltip-border bg-tooltip px-3 py-2 text-[12px] leading-[1.5] text-tooltip-text shadow-[0_4px_16px_#0003]"
		>
			Ctrl+Enter で送信・Enter / Shift+Enter で改行・Shift +
			ドロップでファイル添付
		</span>
	);
}

/** 入力欄の拡張・操作案内と送信方式に応じた案内文を表示する。 */
function ComposerTextField({
	inputId,
	helpId,
	setShowHelp,
	locked,
	expanded,
	followUp,
}: ComposerTextFieldProps) {
	return (
		<PlainTextPlugin
			contentEditable={
				<ContentEditable
					id={inputId}
					aria-label="Codexへのメッセージ"
					aria-describedby={helpId}
					onFocus={() => setShowHelp(true)}
					onBlur={() => setShowHelp(false)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							setShowHelp(false);
						}
					}}
					aria-disabled={locked}
					spellCheck={false}
					className={cn(
						"composer-content min-h-[65px] overflow-y-auto overscroll-y-contain p-1",
						"text-input-text leading-[1.7] [scrollbar-width:thin]",
						"focus-visible:outline-2 focus-visible:outline-focus",
						expanded
							? "h-[min(65dvh,calc(100dvh-300px))]"
							: "max-h-[min(360px,45vh)]",
					)}
				/>
			}
			placeholder={
				<span className="pointer-events-none absolute top-1 left-1 text-input-placeholder">
					{followUp ? "フォローアップを送信" : "チャットを送信"}
				</span>
			}
			ErrorBoundary={LexicalErrorBoundary}
		/>
	);
}

/** 入力欄の拡張状態に対応する操作ボタンを描画する。 */
function renderExpandButton(
	expanded: boolean,
	inputId: string,
	setExpanded: Dispatch<SetStateAction<boolean>>,
) {
	return (
		<SettingsTooltip
			content={
				expanded ? "入力エリアを元のサイズに戻す" : "入力エリアを拡張"
			}
		>
			<button
				type="button"
				className="flex h-7 w-7 shrink-0 items-center justify-center border-0 bg-transparent p-1 text-muted hover:text-input-text"
				aria-label={
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
		</SettingsTooltip>
	);
}

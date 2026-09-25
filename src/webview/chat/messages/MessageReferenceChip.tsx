// 送信済みの参照を、削除操作のないインラインチップで表示する。
import type { ComposerTarget } from "../../../shared/composerTargets";
import { pathText } from "../../../shared/composerReferences";
import type { UiMessage } from "../../../shared/messages";
import {
	referenceIcon,
	referenceActionLabel,
} from "../composer/referencePresentation";

/** 参照の種別に応じて Host へ開く操作を渡す。 */
export function MessageReferenceChip({
	path,
	send,
}: {
	path: ComposerTarget;
	send: ((message: UiMessage) => void) | undefined;
}) {
	const Icon = referenceIcon(path);
	return (
		<button
			type="button"
			title={pathText(path)}
			aria-label={referenceActionLabel(path)}
			disabled={!send}
			className="message-reference inline-flex max-w-full items-center gap-[5px] rounded-[5px] border border-solid border-panel-border bg-input px-[5px] py-[4px] text-[12px] leading-normal align-middle hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus [&_svg]:shrink-0"
			onClick={() => {
				const requestId = crypto.randomUUID();
				if (path.kind === "changes") {
					send?.({
						type: "changes/open",
						requestId,
						scope: path.scope,
					});
				} else if (path.kind === "session") {
					send?.({
						type: "session/openReference",
						requestId,
						referencedSessionId: path.sessionId,
					});
				} else {
					const range = path.range ?? path.symbol?.range;
					send?.({
						type: "reference/open",
						requestId,
						uri: path.uri,
						...(range ? { range } : {}),
					});
				}
			}}
		>
			<Icon size={14} aria-hidden="true" />
			<span className="truncate">
				{path.name}
				{path.kind === "file" && path.range
					? `(${path.range.start.line}:${path.range.end.line})`
					: ""}
			</span>
		</button>
	);
}

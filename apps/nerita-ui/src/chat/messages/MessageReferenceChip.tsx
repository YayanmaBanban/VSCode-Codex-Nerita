// 送信済みの参照を、削除操作のないインラインチップで表示する。
import { SettingsTooltip } from "../SettingsTooltip";
import { cn } from "cnfast";
import type { ComposerTarget } from "@nerita/shared/composerTargets";
import { pathText } from "@nerita/shared/composerReferences";
import type { UiMessage } from "@nerita/shared/messages";
import { referenceActionLabel } from "../composer/referencePresentation";

import { ReferenceChipContent } from "../ReferenceChipContent";

/** 参照の種別に応じて Host へ開く操作を渡す。 */
export function MessageReferenceChip({
	path,
	send,
}: {
	path: ComposerTarget;
	send: ((message: UiMessage) => void) | undefined;
}) {
	return (
		<SettingsTooltip content={pathText(path)}>
			<button
				type="button"
				aria-label={referenceActionLabel(path)}
				disabled={!send}
				className={cn(
					"message-reference inline-flex max-w-full items-center gap-[5px] px-[5px]",
					"py-[4px] align-middle",
					"[&_svg]:shrink-0",
					"rounded-[5px] border border-solid border-panel-border bg-input",
					"text-[12px] leading-normal",
					"hover:bg-settings-hover",
					"focus-visible:outline-2 focus-visible:outline-focus",
				)}
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
				<ReferenceChipContent path={path} />
			</button>
		</SettingsTooltip>
	);
}

// 入力中と送信済みの参照チップで、アイコン・名前・行範囲を揃える。
import type { ComposerTarget } from "@nerita/shared/composerTargets";
import { referenceIcon } from "./composer/referencePresentation";

/** 参照の表示内容だけを作り、チップの操作は呼び出し側が担当する。 */
export function ReferenceChipContent({ path }: { path: ComposerTarget }) {
	const Icon = referenceIcon(path);
	return (
		<>
			<Icon size={14} aria-hidden="true" />
			<span className="truncate">
				{path.kind === "session"
					? `${path.mode === "handoff" ? "Handoff" : "Session"}: ${path.name}`
					: path.name}
				{path.kind === "file" && path.range
					? `(${path.range.start.line}:${path.range.end.line})`
					: ""}
			</span>
		</>
	);
}

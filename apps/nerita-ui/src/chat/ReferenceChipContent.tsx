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
				{referenceLabel(path)}
				{path.kind === "file" && path.range
					? `(${path.range.start.line}:${path.range.end.line})`
					: ""}
			</span>
		</>
	);
}

/** セッションの参照形式を名前に添え、原文の参照と生成するハンドオフを区別する。 */
function referenceLabel(path: ComposerTarget): string {
	if (path.kind !== "session") {
		return path.name;
	}
	const kind = path.mode === "handoff" ? "Handoff" : "Session";
	return `${kind}: ${path.name}`;
}

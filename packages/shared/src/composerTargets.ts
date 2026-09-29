// ファイル・シンボル・セッションを共通のインライン参照として扱う。
import { isWorkspacePath, type WorkspacePath } from "./workspacePaths";
import { isSessionReference, type SessionReference } from "./sessionReferences";
import { isChangeReference, type ChangeReference } from "./changeReferences";

/** チップが保持する参照先。セッションをファイル URI と混同しない。 */
export type ComposerTarget = WorkspacePath | SessionReference | ChangeReference;

/** 下書きとクリップボードの参照先を検証する。 */
export function isComposerTarget(value: unknown): value is ComposerTarget {
	return (
		isWorkspacePath(value) ||
		isSessionReference(value) ||
		isChangeReference(value)
	);
}

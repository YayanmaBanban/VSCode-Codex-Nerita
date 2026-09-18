// 履歴一覧と参照候補で同じ取得元を使う。
import type { ThreadSourceKind } from "../../codex-app-server/v2/ThreadSourceKind";
/** ユーザーが指定した順序で取得元を列挙する。 */
export const threadSources: ThreadSourceKind[] = [
	"cli",
	"vscode",
	"exec",
	"appServer",
	"unknown",
];

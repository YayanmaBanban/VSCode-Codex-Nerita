// 同名の会話と次ページを使い、セッション参照の候補選択を再現する。
import type {
	SessionReferencesRequest,
	SessionReferencesResult,
} from "../../../shared/sessionReferences";
/** 作業フォルダーで絞った結果を、サーバーのページ順で返す。 */
export function mockSessionReferences(
	request: SessionReferencesRequest,
): SessionReferencesResult {
	const all = [
		{
			kind: "session" as const,
			mode: "transcript" as const,
			sessionId: "saved-ui-1",
			name: "UI設計",
			cwd: "D:/workspace/project",
		},
		{
			kind: "session" as const,
			mode: "transcript" as const,
			sessionId: "saved-ui-2",
			name: "UI設計",
			cwd: "D:/workspace/project",
		},
		{
			kind: "session" as const,
			mode: "transcript" as const,
			sessionId: "saved-input",
			name: "入力欄の実装とセッション参照の確認",
			cwd: "D:/workspace/project",
		},
	];
	const filtered = all.filter((entry) => entry.name.includes(request.query));
	return {
		type: "session/references",
		requestId: request.requestId,
		entries: filtered.slice(request.cursor ? 2 : 0, request.cursor ? 4 : 2),
		nextCursor: !request.cursor && filtered.length > 2 ? "second" : null,
		...(request.query === "error"
			? {
					error: "セッションを検索できませんでした。検索し直してください。",
				}
			: {}),
	};
}

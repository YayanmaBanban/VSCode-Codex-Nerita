// 会話を再開せず、Composer の参照候補と原文表示だけを提供する。
import type { PiSession } from "./PiRuntime";
import type {
	SessionReferencesRequest,
	SessionReferencesResult,
	SessionReferenceOpen,
} from "../../../shared/sessionReferences";
import { sameCwd } from "../../workspace";
import { isPiSessionRunning } from "./PiSessionActivity";

/** 同じ作業場所の履歴を検索し、現在の会話を候補から除く。 */
export async function piReferenceAction(
	runtime: PiSession,
	cwd: string,
	message: SessionReferencesRequest | SessionReferenceOpen,
	signal: AbortSignal,
): Promise<SessionReferencesResult | undefined> {
	const history = runtime.history;
	if (!history) {
		throw new Error("セッション参照を利用できません。");
	}
	if (message.type === "session/searchReferences") {
		const rows = (await history.list(signal, true)).filter(
			(row) =>
				row.sessionId !== runtime.sessionId &&
				!isPiSessionRunning(row.sessionId) &&
				sameCwd(row.cwd, cwd) &&
				(row.title ?? row.sessionId)
					.toLocaleLowerCase()
					.includes(message.query.trim().toLocaleLowerCase()),
		);
		signal.throwIfAborted();
		const offset = message.cursor ? Number(message.cursor) : 0;
		if (!Number.isSafeInteger(offset) || offset < 0) {
			throw new Error("参照一覧を検索し直してください。");
		}
		return {
			type: "session/references",
			requestId: message.requestId,
			entries: rows.slice(offset, offset + 50).map((row) => ({
				kind: "session",
				mode: "transcript",
				sessionId: row.sessionId,
				cwd: row.cwd,
				name: (row.title ?? row.sessionId).slice(0, 200),
			})),
			nextCursor: offset + 50 < rows.length ? String(offset + 50) : null,
		};
	}
	if (!history.readContext) {
		throw new Error("原文を読み込めません。");
	}
	const content = await history.readContext(
		message.referencedSessionId,
		"transcript",
		signal,
	);
	signal.throwIfAborted();
	const vscode = await import("vscode");
	const document = await vscode.workspace.openTextDocument({
		language: "plaintext",
		content,
	});
	signal.throwIfAborted();
	await vscode.window.showTextDocument(document, { preview: true });
	return undefined;
}

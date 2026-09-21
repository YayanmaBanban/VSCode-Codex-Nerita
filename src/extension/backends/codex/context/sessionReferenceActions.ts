// 履歴パネルを変更せず、コンポーザー用の候補検索と内容表示を行う。
import type { CodexConnection } from "../runtime/connection";
import {
	type SessionReferenceOpen,
	type SessionReferencesRequest,
	type SessionReferencesResult,
	isSessionReference,
} from "../../../../shared/sessionReferences";
import { sameCwd } from "../../../workspace";
import { threadSources } from "../history/threadSources";
import { readSessionContext } from "./sessionContext";

/** 同じcwdの通常履歴を更新日時順で一ページ返す。 */
export async function searchSessionReferences(
	client: CodexConnection,
	cwd: string,
	sessionId: string,
	request: SessionReferencesRequest,
	current: () => boolean,
): Promise<SessionReferencesResult> {
	const result: SessionReferencesResult = {
		type: "session/references",
		requestId: request.requestId,
		entries: [],
		nextCursor: null,
	};
	try {
		const page = await client.listThreads({
			cwd,
			archived: false,
			limit: 50,
			sortKey: "updated_at",
			sortDirection: "desc",
			modelProviders: [],
			sourceKinds: threadSources,
			...(request.query.trim()
				? { searchTerm: request.query.trim() }
				: {}),
			...(request.cursor ? { cursor: request.cursor } : {}),
		});
		if (
			!current() ||
			(page.nextCursor !== null && page.nextCursor === request.cursor)
		) {
			throw new Error("Stale or repeated page");
		}
		result.entries = page.data
			.filter(
				(thread) =>
					thread.id !== sessionId &&
					sameCwd(thread.cwd, cwd) &&
					!thread.active,
			)
			.map((thread) => ({
				kind: "session" as const,
				sessionId: thread.id,
				name: (
					thread.name?.trim() ||
					thread.preview ||
					thread.id
				).slice(0, 200),
				cwd: thread.cwd,
			}))
			.filter(isSessionReference);
		result.nextCursor = page.nextCursor;
	} catch {
		result.error =
			"セッションを検索できませんでした。接続を確認し、検索し直してください。";
	}
	return result;
}

/** 会話を切り替えず、参照と同じ本文をVS Codeのテキストエディターで表示する。 */
export async function openSessionReference(
	client: CodexConnection,
	cwd: string,
	request: SessionReferenceOpen,
	current: () => boolean,
): Promise<void> {
	const content = await readSessionContext(
		client,
		request.referencedSessionId,
		cwd,
		current,
	);
	if (!current()) {
		return;
	}
	const vscode = await import("vscode");
	const document = await vscode.workspace.openTextDocument({
		language: "plaintext",
		content,
	});
	if (current()) {
		await vscode.window.showTextDocument(document, {
			viewColumn: vscode.ViewColumn.Active,
			preview: true,
		});
	}
}

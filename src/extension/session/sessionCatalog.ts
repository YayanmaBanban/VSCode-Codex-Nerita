// セッション一覧のページ取得と作業フォルダの照合を担当する。
import path from "node:path";
import type { AcpTransport } from "../acp/transport";
import type { SessionSummary } from "../../shared/sessionHistory";

/** Windows の大小文字・区切り・末尾スラッシュの差を吸収する。 */
export function sameCwd(left: string, right: string): boolean {
	const normalize = (value: string) =>
		path
			.resolve(value)
			.replace(/[\\/]+$/, "")
			.toLowerCase();
	return normalize(left) === normalize(right);
}
/** 接続が有効な間だけページを取得し、重複と別フォルダを除いて並べる。 */
export async function listProjectSessions(
	transport: AcpTransport,
	current: () => boolean,
): Promise<SessionSummary[] | undefined> {
	const sessions = new Map<string, SessionSummary>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	do {
		const result = await transport.listSessions(cursor);
		if (!current()) {
			return;
		}
		for (const session of result.sessions) {
			if (sameCwd(session.cwd, transport.cwd)) {
				sessions.set(session.sessionId, {
					sessionId: session.sessionId,
					cwd: session.cwd,
					...(typeof session.title === "string"
						? { title: session.title }
						: {}),
					...(typeof session.updatedAt === "string"
						? { updatedAt: session.updatedAt }
						: {}),
				});
			}
		}
		cursor = result.nextCursor ?? undefined;
		if (cursor && cursors.has(cursor)) {
			throw new Error("Repeated cursor");
		}
		if (cursor) {
			cursors.add(cursor);
		}
	} while (cursor);
	const updated = (item: SessionSummary) =>
		Date.parse(item.updatedAt ?? "") || 0;
	return [...sessions.values()].sort((a, b) => updated(b) - updated(a));
}

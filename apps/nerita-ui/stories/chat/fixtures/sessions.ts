// 履歴一覧の表示データ。操作から保存内容を導出しない。
import type { SessionSummary } from "@nerita/shared/sessionHistory";
/** 相対時刻の表示に使う履歴候補を生成する。 */
export function sessionRows(): SessionSummary[] {
	const cwd = "workspace/nerita/とても長いフォルダ名のプロジェクト";
	const sessions: SessionSummary[] = [
		{
			sessionId: "recent",
			cwd,
			title: "セッション一覧と履歴の読み込みを実装",
			updatedAt: new Date(Date.now() - 120000).toISOString(),
		},
		{
			sessionId: "older",
			cwd,
			title: "長いセッションタイトルでも操作ボタンが隠れず、更新日時を確認できること",
			updatedAt: new Date(Date.now() - 10800000).toISOString(),
		},
		{ sessionId: "untitled", cwd },
	];

	return sessions;
}

/** 表示上限・更新日時による並べ替え・アーカイブ済み履歴の除外を確認するための未整列データ。 */
export function recentSessionRows(): SessionSummary[] {
	const sessions = sessionRows();
	const cwd = sessions[0]!.cwd;
	return [
		{
			sessionId: "oldest",
			cwd,
			title: "古い作業",
			updatedAt: "2020-01-01T00:00:00Z",
		},
		...sessions.map((session) =>
			session.sessionId === "untitled"
				? { ...session, updatedAt: "2021-01-01T00:00:00Z" }
				: session,
		),
		{
			sessionId: "archived",
			cwd,
			title: "アーカイブ済み",
			archived: true,
			updatedAt: new Date().toISOString(),
		},
	];
}

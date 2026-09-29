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

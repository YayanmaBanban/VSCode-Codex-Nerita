// MCP の取得中表示と、接続状態の色付きリストをメッセージ内に描画する。
import { useReducedMotion } from "motion/react";
import type { McpMessageContent } from "../../../shared/mcp";
import { ShinyText } from "../../ui/ShinyText";
import { RunStatusIcon } from "../RunStatusIcon";

/** 取得中は光沢文字と猫を表示し、完了後は状態付きの一覧へ置き換える。 */
export function McpMessage({
	content,
	text,
}: {
	content: McpMessageContent;
	text: string;
}) {
	const reduced = useReducedMotion();
	if (content.status === "loading") {
		return (
			<div
				role="status"
				aria-label="取得中…"
				className="flex items-center gap-1 text-[12px] text-muted"
			>
				<ShinyText
					text="取得中…"
					disabled={reduced === true}
					color="var(--vscode-descriptionForeground, #7d8791)"
					shineColor="var(--vscode-foreground, light-dark(#242e36, #dfe4e9))"
				/>
				<RunStatusIcon kind="loaf" />
			</div>
		);
	}
	if (content.status === "error") {
		return (
			<p role="alert" className="m-0 text-tool-error">
				{text}
			</p>
		);
	}
	return (
		<div>
			<p className="mt-0 mb-2">設定済みMCPサーバー:</p>
			{!content.servers.length ? (
				<p className="m-0 text-muted">MCPサーバーはありません。</p>
			) : (
				<ul
					aria-label="MCPサーバー"
					className="m-0 flex list-none flex-col gap-2 p-0"
				>
					{content.servers.map((server, index) => (
						<li
							key={`${server.name}:${index}`}
							className="flex items-start gap-2"
						>
							<span
								role="img"
								aria-label={server.runtimeStatus ?? "不明"}
								title={server.runtimeStatus ?? "不明"}
								className={`mt-[0.6em] size-2 shrink-0 rounded-full ${serverStatusColor(server.runtimeStatus)}`}
							/>
							<span className="min-w-0 [overflow-wrap:anywhere]">
								{server.name}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** MCP の接続状態を表示色へ変換し、未知の状態は中立色にする。 */
function serverStatusColor(status: string | null) {
	if (status === "connected") {
		return "bg-menu-check";
	}
	if (status === "disabled") {
		return "bg-tool-error";
	}
	return "bg-muted";
}

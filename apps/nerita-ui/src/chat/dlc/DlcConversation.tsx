// Phase 3 に選択した Intent の会話を埋め込み、承認・停止・履歴を共通部品で扱う。
import type { Bridge } from "@nerita/shared/bridge";
import type { DlcView } from "@nerita/shared/dlc/contracts";
import { ChatWorkspace } from "../ChatWorkspace";
import { DlcRunInfo } from "./DlcRunInfo";

/** 会話の接続をエディタの開閉や Phase の展開操作で再生成しない。 */
export function DlcConversation({
	bridge,
	view,
}: {
	bridge: Bridge;
	view: DlcView;
}) {
	return (
		<section
			aria-label="Worktree の会話"
			className="mt-4 h-[70vh] min-h-[360px] overflow-hidden rounded-lg border border-solid border-panel-border"
		>
			<ChatWorkspace
				bridge={bridge}
				managed
				header={({ chat }) => (
					<>
						<DlcRunInfo
							view={view}
							state={chat.state}
							send={chat.send}
						/>
						{chat.requestError !== null &&
							chat.requestError !== view.error && (
								<p
									role="alert"
									className="m-0 px-3 py-2 text-tool-error"
								>
									{chat.requestError}
								</p>
							)}
					</>
				)}
			/>
		</section>
	);
}

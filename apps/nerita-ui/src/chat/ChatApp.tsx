// 通常チャットの表示先を組み立て、DLC の作業画面は独立したエディタで開く。
import type { Bridge } from "@nerita/shared/bridge";
import { ChatWorkspace } from "./ChatWorkspace";
import { ChatModeHeader } from "./ChatModeHeader";

/** 差し替え可能なブリッジを使って実環境と Storybook で同じ UI を動かす。 */
export function ChatApp({ bridge }: { bridge: Bridge }) {
	return (
		<main className="m-auto h-dvh min-h-[360px] max-w-[1350px]">
			<ChatWorkspace
				bridge={bridge}
				header={(props) => <ChatModeHeader {...props} />}
			/>
		</main>
	);
}

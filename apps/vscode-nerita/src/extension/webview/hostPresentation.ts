// VS Code の保存先や認証・復旧操作の案内を、プラットフォームを知らない UI へ提供する。
import type { Webview } from "vscode";
import {
	hostPresentationRequestSchema,
	type HostPresentation,
} from "@nerita/shared/hostPresentation";

export const vscodeHostPresentation: HostPresentation = {
	credentialStorageLabels: {
		session: "このセッションのみ",
		"secret-storage": "VS Code に保存",
	},
	autoReviewStorageDescription:
		"設定はこのワークスペースの VS Code 保存領域で管理します。",
	guardrailsRepairDescription:
		"設定ファイルを読み込めません。.pi/guardrails.json を VS Code のテキストエディターで開き、エラーを修正してください。",
	trust: {
		codexStorageDescription: "Codex: グローバル config.toml に保存",
		piStorageDescription:
			"Pi: Nerita の信頼設定を VS Code のストレージに保存",
		piStorageKey: "nerita.workspaceTrust.v1",
	},
	authentication: {
		codex: {
			required:
				"ChatGPT にログインするか、VS Code の起動環境に設定した API キーを使用します。",
			pending:
				"ブラウザーでログインを完了してください。最大3分間待機します。",
		},
		pi: {
			required: "Pi の認証情報を設定してください。",
			pending:
				"エディターの「Pi 認証情報」で設定してください。画面を閉じるとチャットへ戻れます。",
		},
	},
};

/** 画面固有の要求検証や待機列へ入れる前に処理し、操作中でも表示情報を取得できるようにする。 */
export function replyHostPresentation(
	webview: Pick<Webview, "postMessage">,
	value: unknown,
): boolean {
	if (!hostPresentationRequestSchema.safeParse(value).success) {
		return false;
	}
	void webview.postMessage({
		type: "host/presentation",
		presentation: vscodeHostPresentation,
	});
	return true;
}

/** 通常の受信処理と同じ購読の寿命で共通の初期要求を処理する。 */
export function withHostPresentation(
	webview: Pick<Webview, "postMessage">,
	receive: (value: unknown) => void,
) {
	return (value: unknown) => {
		if (!replyHostPresentation(webview, value)) {
			receive(value);
		}
	};
}

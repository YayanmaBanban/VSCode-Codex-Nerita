// 操作から独立したチャットの表示状態を生成する。
import { initialState, type ChatState } from "../../../shared/chatState";
import {
	codexAuthMethods,
	codexConnectionText,
} from "../../../shared/codexConnection";
import { settingsFixture } from "../../../../tests/fixtures/settingsFixture";
/** ストーリーの開始状態。 */
export type Scenario =
	| "empty"
	| "connecting"
	| "auth"
	| "streaming"
	| "completed"
	| "permission"
	| "cancelled"
	| "cancelling"
	| "failed"
	| "error";
/** 固定状態と操作シナリオのための初期スナップショットを生成する。 */
export function scenarioState(scenario: Scenario): ChatState {
	const state: ChatState = {
		...initialState(),
		connection: "ready",
		cwd: "workspace/project",
		sessionId: "story-session",
		configOptions: settingsFixture(),
	};
	if (scenario === "connecting") {
		state.connection = "connecting";
	}
	if (scenario === "auth") {
		state.connection = "auth-required";
		state.authMethods = codexAuthMethods();
	}
	if (scenario === "error") {
		state.connection = "error";
		state.error = codexConnectionText.disconnected;
	}
	if (
		[
			"streaming",
			"completed",
			"permission",
			"cancelled",
			"cancelling",
			"failed",
		].includes(scenario)
	) {
		state.runId = "story-run";
		state.messages = [
			{
				id: "user",
				role: "user",
				text: "設定ファイルの変更点を教えてください。",
			},
			{
				id: "assistant",
				role: "assistant",
				text: "設定を確認しています。\n\n変更はワークスペース内のファイルに限定し、型検査を実行します。",
			},
		];
		state.run = "running";
	}
	if (scenario === "completed") {
		state.run = "completed";
		state.messages[1]!.text = `設定ファイルの変更点を整理しました。\n\n\`\`\`ts\nconst config = { strict: true, target: 'ES2022' };\n\`\`\`\n\n型の検査を有効にして、実行前に問題を発見できる構成です。\n${"長いパスやコードも画面の幅に合わせて折り返します。".repeat(12)}`;
	}
	if (scenario === "permission") {
		state.tools = [
			{
				id: "edit",
				title: "設定ファイルを更新",
				status: "pending",
				paths: ["src/config/settings.ts"],
			},
		];
		state.permissions = [
			{
				id: "permission",
				title: "設定ファイルの変更を許可しますか？",
				options: [
					{ id: "allow", name: "今回のみ許可", kind: "allow_once" },
					{ id: "reject", name: "拒否", kind: "reject_once" },
				],
			},
		];
	}
	if (
		scenario === "cancelled" ||
		scenario === "cancelling" ||
		scenario === "failed"
	) {
		state.run = scenario;
	}
	return state;
}

// タイトルを履歴一覧の表示条件から独立して保持することを確認する。
import { expect, it } from "vitest";
import { SessionState } from "../../src/extension/session/sessionState";
import type { ChatState } from "../../src/shared/chatState";
/** 通知を再現するため、正本の更新だけをテストへ公開する。 */
class TitleState extends SessionState {
	update(patch: Partial<ChatState>) {
		this.patch(patch);
	}
}
it("一覧の再取得・アーカイブ表示では現在のタイトルを消さない", () => {
	const state = new TitleState();
	state.update({
		sessionId: "active",
		sessions: [
			{ sessionId: "active", title: "現在の会話", cwd: "workspace" },
		],
	});
	expect(state.snapshot().sessionTitle).toBe("現在の会話");
	state.update({ sessions: [], sessionsLoading: true });
	state.update({
		sessionsArchived: true,
		sessions: [
			{ sessionId: "archived", title: "別の会話", cwd: "workspace" },
		],
	});
	expect(state.snapshot().sessionTitle).toBe("現在の会話");
	state.update({ sessionId: "new" });
	expect(state.snapshot().sessionTitle).toBeNull();
});
it("復元・改名の確定タイトルを反映し、現在の会話を閉じたら消す", () => {
	const state = new TitleState();
	state.update({ sessionId: "restored", sessionTitle: "復元された会話" });
	state.update({ sessionTitle: "変更後" });
	expect(state.snapshot().sessionTitle).toBe("変更後");
	state.update({ sessionId: null });
	expect(state.snapshot().sessionTitle).toBeNull();
});

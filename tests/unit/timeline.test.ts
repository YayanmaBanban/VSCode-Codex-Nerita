// App Server の項目 ID を使い、本文とツールの順序・次の送信での履歴保持を検証する。
import { expect, it } from "vitest";
import { codexHarness } from "./codexHarness";
import type { HostMessage } from "../../src/shared/messages";

it("本文をツール前後で分け、次の送信でも履歴を保持する", async () => {
	const h = codexHarness();
	try {
		await h.session.connect();
		await h.send("調べて");
		const scope = { threadId: "thread-1", turnId: "turn-1" };
		const chunk = (itemId: string, delta: string) =>
			h.notify("item/agentMessage/delta", { ...scope, itemId, delta });
		chunk("before", "確認");
		chunk("before", "します");
		const item = {
			type: "commandExecution",
			id: "cmd",
			command: "echo test",
			cwd: "D:/workspace",
		};
		h.notify("item/started", { ...scope, item });
		chunk("after", "結果です");
		h.notify("item/completed", {
			...scope,
			item: { ...item, status: "completed", aggregatedOutput: "test" },
		});
		chunk("after", "。");
		const before = h.session.snapshot();
		expect(before.messages.map((m) => m.text)).toEqual([
			"調べて",
			"確認します",
			"結果です。",
		]);
		expect(before.messages[1]!.order).toBeLessThan(before.tools[0]!.order!);
		expect(before.tools[0]!.order).toBeLessThan(before.messages[2]!.order!);
		h.complete();
		await h.send("続けて");
		expect(h.session.snapshot().tools).toEqual(before.tools);
		expect(h.session.snapshot().messages.at(-1)!.order).toBeGreaterThan(
			before.messages.at(-1)!.order!,
		);
	} finally {
		await h.session.dispose();
	}
});

it("Webview再表示にスナップショットを返し、購読解除と正本の保護を維持する", async () => {
	const h = codexHarness();
	try {
		await h.session.connect();
		const events: HostMessage[] = [];
		const unsubscribe = h.session.subscribe((event) => events.push(event));
		await h.session.receive({ type: "ui/ready" });
		expect(events).toEqual([
			{ type: "state/snapshot", state: h.session.snapshot() },
		]);
		unsubscribe();
		await h.session.receive({ type: "ui/ready" });
		expect(events).toHaveLength(1);
		h.session.snapshot().messages.push({
			id: "external",
			role: "user",
			text: "must not persist",
		});
		expect(h.session.snapshot().messages).toEqual([]);
	} finally {
		await h.session.dispose();
	}
});

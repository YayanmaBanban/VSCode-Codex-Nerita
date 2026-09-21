// スキル一覧の検証と、通常送信・追加送信に渡すコンテキストを確認する。
import { expect, it, vi } from "vitest";
import { parseSkills } from "../../src/extension/backends/codex/protocol/skills";
import { skillInput } from "../../src/extension/backends/codex/context/skillInput";
import { codexHarness } from "./codexHarness";

const skill = {
	name: "review",
	description: "確認",
	path: "D:/skills/review/SKILL.md",
};
it("一覧の構造を検証し、無効なスキルを候補から除く", () => {
	expect(
		parseSkills({
			data: [
				{
					skills: [
						{ ...skill, enabled: true },
						{ ...skill, name: "off", enabled: false },
					],
				},
			],
		}),
	).toEqual([skill]);
	expect(() =>
		parseSkills({ data: [{ skills: [{ name: "broken" }] }] }),
	).toThrow();
	expect(skillInput("文中@review\n@unknown", [skill])).toEqual([]);
	expect(skillInput("@review 確認\n@review 再確認", [skill])).toEqual([
		{ type: "skill", name: skill.name, path: skill.path },
	]);
});
it("接続先のスキルを取得して開始とフォローアップに渡す", async () => {
	const h = codexHarness();
	Object.assign(h.client, {
		listSkills: vi.fn(() => Promise.resolve([skill])),
	});
	try {
		await h.session.connect();
		expect(h.session.snapshot().skills).toEqual([skill]);
		await h.send("@review この変更を確認");
		expect(h.client.startTurn.mock.calls.at(-1)?.[0].input).toContainEqual({
			type: "skill",
			name: skill.name,
			path: skill.path,
		});
		await h.send("@review 追加の確認");
		expect(h.client.steerTurn.mock.calls.at(-1)?.[0].input).toContainEqual({
			type: "skill",
			name: skill.name,
			path: skill.path,
		});
	} finally {
		await h.session.dispose();
	}
});

it("/newはモデルへ送らず、新しい会話の受付を通知する", async () => {
	const h = codexHarness();
	try {
		await h.session.connect();
		const previous = h.session.snapshot().sessionId;
		const listener = vi.fn();
		h.session.subscribe(listener);
		await h.send("/new");
		expect(h.session.snapshot().sessionId).not.toBe(previous);
		expect(h.client.startTurn).not.toHaveBeenCalled();
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ type: "prompt/accepted" }),
		);
	} finally {
		await h.session.dispose();
	}
});

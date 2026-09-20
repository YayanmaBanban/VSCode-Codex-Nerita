// 一時ディレクトリだけを使い、TOMLの永続化・優先順位・通信検証を確認する。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { parse, stringify } from "smol-toml";
import { PersonalityStore } from "../../src/extension/codex/settings/PersonalityStore";
import { composeDeveloperInstructions } from "../../src/shared/personality";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
/** 実ユーザーの設定に触れない保存先を用意する。 */
async function fixture() {
	const root = resolve("dist/personality-tests", randomUUID());
	const home = join(root, "home");
	const cwd = join(root, "workspace");
	const configHome = join(root, "codex-home");
	await Promise.all([
		mkdir(home, { recursive: true }),
		mkdir(cwd, { recursive: true }),
		mkdir(configHome, { recursive: true }),
		mkdir(join(cwd, ".codex"), { recursive: true }),
	]);
	return {
		home,
		cwd,
		configHome,
		store: new PersonalityStore(cwd, home, configHome),
	};
}
it("複数プリセットの保存・更新・選択を再起動後も保持し、順序どおり結合する", async () => {
	const { store, home, cwd, configHome } = await fixture();
	await store.change({
		type: "personality/save",
		requestId: "1",
		scope: "global",
		name: "簡潔",
		text: '日本語\n引用: "text"\nパス: C:\\work',
		originalName: "",
	});
	await store.change({
		type: "personality/save",
		requestId: "2",
		scope: "global",
		name: "詳しく",
		text: "説明する",
		originalName: "簡潔",
	});
	await store.change({
		type: "personality/save",
		requestId: "3",
		scope: "global",
		name: "詳しく",
		text: "詳しく説明する",
		originalName: "詳しく",
	});
	await store.change({
		type: "personality/save",
		requestId: "4",
		scope: "workspace",
		name: "設計",
		text: "既存設計を優先",
		originalName: "",
	});
	const restored = await new PersonalityStore(cwd, home, configHome).read();
	expect(restored.global.presets).toHaveLength(2);
	expect(composeDeveloperInstructions(restored)).toBe(
		"詳しく説明する\n\n既存設計を優先",
	);
	await store.change({
		type: "personality/select",
		requestId: "5",
		scope: "global",
		name: "簡潔",
	});
	expect((await store.read()).global.presets[0]?.text).toContain(
		'引用: "text"',
	);
	const serialized = await readFile(
		join(home, ".codex/nerita/preset.toml"),
		"utf8",
	);
	expect(serialized).toContain("[[presets]]");
	expect(parse(serialized).selected).toBe("簡潔");
});
it("CODEX_HOMEとワークスペースのconfig.tomlは空文字も含めて読み取り専用にする", async () => {
	const { store, configHome, cwd } = await fixture();
	await writeFile(
		join(configHome, "config.toml"),
		stringify({ developer_instructions: "グローバルの固定指示" }),
	);
	await writeFile(
		join(cwd, ".codex/config.toml"),
		stringify({ developer_instructions: "" }),
	);
	const state = await store.read();
	expect(state.workspace.configuredText).toBe("");
	expect(composeDeveloperInstructions(state)).toBe("グローバルの固定指示");
	for (const scope of ["global", "workspace"] as const) {
		await expect(
			store.change({
				type: "personality/save",
				requestId: "1",
				scope,
				name: "上書き",
				text: "変更",
				originalName: "",
			}),
		).rejects.toThrow("変更できません");
	}
});
it("破損したTOMLや同名への新規保存を拒否して既存内容を残す", async () => {
	const { store, home } = await fixture();
	await store.change({
		type: "personality/save",
		requestId: "1",
		scope: "global",
		name: "既存",
		text: "保持",
		originalName: "",
	});
	await expect(
		store.change({
			type: "personality/save",
			requestId: "2",
			scope: "global",
			name: "既存",
			text: "変更",
			originalName: "別名",
		}),
	).rejects.toThrow("同名");
	expect((await store.read()).global.presets[0]?.text).toBe("保持");
	const path = join(home, ".codex/nerita/preset.toml");
	await writeFile(path, "[presets]\nname='a'\n[ pres ets");
	await expect(store.read()).rejects.toThrow();
	await expect(
		store.change({
			type: "personality/select",
			requestId: "3",
			scope: "global",
			name: "",
		}),
	).rejects.toThrow();
	expect(await readFile(path, "utf8")).toContain("[ pres ets");
});
it("選択なしと並行保存を扱い、別ワークスペースに指示を混ぜない", async () => {
	const { store, home, cwd, configHome } = await fixture();
	await Promise.all(
		["a", "b"].map((name) =>
			store.change({
				type: "personality/save",
				requestId: name,
				scope: "global",
				name,
				text: name,
				originalName: "",
			}),
		),
	);
	expect((await store.read()).global.presets).toHaveLength(2);
	await store.change({
		type: "personality/select",
		requestId: "3",
		scope: "global",
		name: "",
	});
	await store.change({
		type: "personality/save",
		requestId: "4",
		scope: "workspace",
		name: "local",
		text: "local",
		originalName: "",
	});
	expect(
		composeDeveloperInstructions(
			await new PersonalityStore(`${cwd}-other`, home, configHome).read(),
		),
	).toBe("");
});
it("不正なスコープ・長すぎる本文・不正なHost設定を通信境界で拒否する", () => {
	const message = {
		type: "personality/save",
		requestId: "1",
		scope: "global",
		name: "設定",
		text: "日本語",
		originalName: "",
	};
	expect(isUiMessage(message)).toBe(true);
	expect(isUiMessage({ ...message, scope: "../../outside" })).toBe(false);
	expect(isUiMessage({ ...message, scope: ["global"] })).toBe(false);
	expect(isUiMessage({ ...message, text: "a".repeat(100_001) })).toBe(false);
	expect(
		isHostMessage({
			type: "state/patch",
			revision: 1,
			patch: { personality: { global: {}, workspace: {} } },
		}),
	).toBe(false);
});

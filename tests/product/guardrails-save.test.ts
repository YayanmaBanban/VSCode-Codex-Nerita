// 保存と適用の一操作化で、保存失敗・文書競合が実行中のルールを変更しないことを検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import { saveGuardrails } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/saveGuardrails";
import { GuardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";

/** VS Code の文書保存だけを代替し、適用と旧世代の失効は製品の Registry で確認する。 */
function fixture() {
	const root = join(process.cwd(), "guardrails-workspace");
	const registry = new GuardrailRegistry();
	const original = registry.snapshot(root, [root]);
	const config = defaultGuardrails();
	config.pathAccess.outsideRead = "ask";
	config.builtins.paths.ssh = "ask";
	config.builtins.commands.git = "deny";
	let text = JSON.stringify(config);
	let savedText: string | undefined;
	let applied = false;
	const document = {
		version: 2,
		isDirty: true,
		getText: () => text,
		save: () => {
			savedText = text;
			document.isDirty = false;
			return Promise.resolve(true);
		},
	};
	return {
		document,
		original,
		setText(value: string) {
			text = value;
		},
		get savedText() {
			return savedText;
		},
		get applied() {
			return applied;
		},
		current: () => registry.snapshot(root, [root]),
		apply: (value: string, isCurrent: () => boolean) => {
			assert.equal(isCurrent(), true);
			assert.equal(savedText, value);
			registry.apply(root, parseGuardrails(value));
			applied = true;
			return Promise.resolve();
		},
	};
}

void test("保存した内容を一操作で適用し、旧設定の承認を失効させる", async () => {
	const f = fixture();
	await saveGuardrails(f.document, 2, f.apply);
	assert.equal(f.applied, true);
	assert.equal(f.document.isDirty, false);
	assert.equal(f.current().config.pathAccess.outsideRead, "ask");
	assert.equal(f.current().config.builtins.paths.ssh, "ask");
	assert.equal(f.current().config.builtins.commands.git, "deny");
	assert.equal(f.original.signal.aborted, true);
});

for (const failure of ["false", "throw", "invalid"] as const) {
	void test(`保存できない場合は実行設定と承認を維持する: ${failure}`, async () => {
		const f = fixture();
		if (failure === "invalid") {
			f.setText("{ invalid");
		} else {
			f.document.save = () =>
				failure === "throw"
					? Promise.reject(new Error("disk failure"))
					: Promise.resolve(false);
		}
		await assert.rejects(saveGuardrails(f.document, 2, f.apply));
		assert.equal(f.savedText, undefined);
		assert.equal(f.applied, false);
		assert.equal(f.current().digest, f.original.digest);
		assert.equal(f.original.signal.aborted, false);
	});
}

for (const conflict of ["version", "text", "dirty"] as const) {
	void test(`保存中に文書が変わった場合は適用しない: ${conflict}`, async () => {
		const f = fixture();
		const save = f.document.save;
		f.document.save = async () => {
			await save();
			if (conflict === "version") {
				f.document.version++;
			}
			if (conflict === "text") {
				f.setText(`${f.document.getText()} `);
			}
			if (conflict === "dirty") {
				f.document.isDirty = true;
			}
			return true;
		};
		await assert.rejects(saveGuardrails(f.document, 2, f.apply));
		assert.equal(f.applied, false);
		assert.equal(f.current().digest, f.original.digest);
		assert.equal(f.original.signal.aborted, false);
	});
}

void test("保存後の適用に失敗した場合も旧設定を維持する", async () => {
	const f = fixture();
	await assert.rejects(
		saveGuardrails(f.document, 2, () =>
			Promise.reject(new Error("persistence failure")),
		),
	);
	assert.equal(f.savedText, f.document.getText());
	assert.equal(f.document.isDirty, false);
	assert.equal(f.current().digest, f.original.digest);
	assert.equal(f.original.signal.aborted, false);
});

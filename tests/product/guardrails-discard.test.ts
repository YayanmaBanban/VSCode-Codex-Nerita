// 適用中の設定への復元で、競合・保存失敗を見逃さず、実行設定を維持することを検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defaultGuardrails,
	parseGuardrails,
} from "@nerita/shared/guardrails/config";
import { discardGuardrails } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/discardGuardrails";
import { GuardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";

/** 文書編集・保存の境界だけを代替し、実行設定は製品のRegistryを使用する。 */
function fixture() {
	const root = process.cwd();
	const registry = new GuardrailRegistry();
	const active = registry.snapshot(root, [root]);
	const changed = defaultGuardrails();
	changed.pathAccess.outsideRead = "ask";
	let text = JSON.stringify(changed);
	let saved: string | undefined;
	let replacements = 0;
	const document = {
		version: 3,
		isDirty: false,
		getText: () => text,
		save: () => {
			saved = text;
			document.isDirty = false;
			return Promise.resolve(true);
		},
	};
	const replace = (value: string) => {
		replacements++;
		text = value;
		document.version++;
		document.isDirty = true;
		return Promise.resolve(true);
	};
	return {
		document,
		active,
		replace,
		registry,
		root,
		get saved() {
			return saved;
		},
		get replacements() {
			return replacements;
		},
	};
}

for (const dirty of [false, true]) {
	void test(`適用中の設定を上書き保存し、実行設定と承認の世代は維持する: dirty=${dirty}`, async () => {
		const f = fixture();
		f.document.isDirty = dirty;
		await discardGuardrails(
			f.document,
			3,
			JSON.stringify(f.active.config),
			() => !f.active.signal.aborted,
			f.replace,
		);
		assert.deepEqual(parseGuardrails(f.saved!), f.active.config);
		assert.equal(f.document.isDirty, false);
		assert.equal(f.active.signal.aborted, false);
		assert.equal(
			f.registry.snapshot(f.root, [f.root]).digest,
			f.active.digest,
		);
	});
}

for (const failure of [
	"version",
	"dirty-version",
	"active",
	"invalid",
] as const) {
	void test(`復元元を確定できない場合は文書を上書きしない: ${failure}`, async () => {
		const f = fixture();
		f.document.isDirty = failure === "dirty-version";
		const version =
			failure === "version" || failure === "dirty-version" ? 2 : 3;
		const text =
			failure === "invalid" ? "" : JSON.stringify(f.active.config);
		await assert.rejects(
			discardGuardrails(
				f.document,
				version,
				text,
				() => failure !== "active",
				f.replace,
			),
		);
		assert.equal(f.replacements, 0);
		assert.equal(f.saved, undefined);
		assert.equal(f.active.signal.aborted, false);
	});
}

for (const failure of ["replace", "save", "changed", "active"] as const) {
	void test(`復元・保存の失敗は成功にせず実行設定を維持する: ${failure}`, async () => {
		const f = fixture();
		let current = true;
		const replace = async (text: string) => {
			if (failure === "replace") {
				return false;
			}
			await f.replace(text);
			current = failure !== "active";
			return true;
		};
		f.document.save = () => {
			f.document.isDirty = false;
			if (failure === "changed") {
				f.document.version++;
			}
			return Promise.resolve(failure !== "save");
		};
		await assert.rejects(
			discardGuardrails(
				f.document,
				3,
				JSON.stringify(f.active.config),
				() => current,
				replace,
			),
		);
		assert.equal(f.active.signal.aborted, false);
		assert.equal(
			f.registry.snapshot(f.root, [f.root]).digest,
			f.active.digest,
		);
	});
}

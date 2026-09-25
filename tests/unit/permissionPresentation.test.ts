// 承認の表示内容が通信境界を通り、実行条件を欠落させないことを確認する。
import { expect, it } from "vitest";
import { validStateField } from "../../src/shared/stateFieldValidation";
import { toolApprovalPresentation } from "../../src/extension/security/toolApprovalPresentation";
import { parseApproval } from "../../src/extension/backends/codex/interaction/Approvals";
import type { ToolCall } from "../../src/extension/security/ApprovedToolCall";

const call: ToolCall = {
	tool: "powershell",
	cwd: "workspace",
	params: { command: "Write-Output 'hello'", timeout: 10 },
	command: [
		"powershell.exe",
		"-Command",
		"initialization\nWrite-Output 'hello'",
	],
	timeoutMs: 10000,
	env: { SECRET: "not-for-display" },
	policy: {
		workspaceRoots: ["workspace"],
		writableRoots: ["workspace"],
		shell: true,
		networkAccess: false,
		windowsSandbox: "elevated",
	},
	sandbox: { name: "Codex", details: ["Windows Sandbox: elevated"] },
};

it("コマンド本文を分離し、実行引数・制限時間・入力を詳細に保持する", () => {
	const result = toolApprovalPresentation(call);
	expect(result.title).toBe("Pi: powershell の実行承認");
	expect(result.command).toBe(call.params.command);
	expect(result.cwd).toBe(call.cwd);
	expect(result.fields).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: "scope", value: "Shell Sandbox" }),
			expect.objectContaining({
				id: "writableRoots",
				value: "workspace",
			}),
			expect.objectContaining({ id: "network", value: "無効" }),
		]),
	);
	expect(
		JSON.parse(result.details!.find((field) => field.id === "argv")!.value),
	).toEqual(call.command);
	expect(result.details).toContainEqual(
		expect.objectContaining({ id: "timeout", value: "10000 ms" }),
	);
	expect(JSON.stringify(result)).not.toContain("not-for-display");
});

it("ファイル操作では入力全文を常時表示し、コマンドを作らない", () => {
	const { command: _command, ...file } = call;
	const result = toolApprovalPresentation({
		...file,
		tool: "write",
		params: { path: "file.txt", content: "first\nlast" },
	});
	expect(result.command).toBeUndefined();
	expect(
		JSON.parse(
			result.fields!.find((field) => field.id === "params")!.value,
		),
	).toEqual({ path: "file.txt", content: "first\nlast" });
	expect(result.fields).toContainEqual(
		expect.objectContaining({
			id: "scope",
			value: "HostファイルTool（Sandbox外）",
		}),
	);
});

it("Codex のコマンド・理由・許可範囲と接続先を別々に保持する", () => {
	const request = parseApproval({
		id: 1,
		method: "item/commandExecution/requestApproval",
		params: {
			threadId: "thread",
			turnId: "turn",
			itemId: "item",
			command: "node --version",
			cwd: "workspace",
			reason: "check",
			grantRoot: "output",
			networkApprovalContext: { host: "example.test", protocol: "https" },
		},
	});
	expect(request.presentation).toMatchObject({
		title: "ネットワーク接続の承認",
		cwd: "workspace",
		command: "node --version",
	});
	expect(request.presentation.fields).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: "network",
				value: "https://example.test",
			}),
			expect.objectContaining({ id: "reason", value: "check" }),
			expect.objectContaining({ id: "grantRoot", value: "output" }),
		]),
	);
});

it("構造化要求と従来のタイトルのみの要求を受理する", () => {
	for (const presentation of [
		toolApprovalPresentation(call),
		{ title: "legacy" },
	]) {
		expect(
			validStateField("permissions", [
				{
					id: "p",
					...presentation,
					options: [
						{ id: "accept", name: "許可", kind: "allow_once" },
					],
				},
			]),
		).toBe(true);
	}
});

it.each([
	{ cwd: 1 },
	{ command: {} },
	{ fields: null },
	{ details: [null] },
	{ fields: [{ id: "f", label: "label", value: {}, display: "code" }] },
	{ details: [{ id: "f", label: "label", value: "value", display: "html" }] },
])("不正な表示項目を受信した場合は拒否する: %j", (invalid) => {
	expect(
		validStateField("permissions", [
			{ id: "p", title: "title", options: [], ...invalid },
		]),
	).toBe(false);
});

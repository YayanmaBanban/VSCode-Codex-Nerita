// 既存の承認表示を標準 UI に渡し、省略される入力や実行条件も確認できるようにする。
import * as vscode from "vscode";
import { relative } from "node:path";
import type { Permission } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import type { ApprovalPrompt } from "./SessionExecution";

/** キャンセルは未回答として返し、バックエンドが拒否・中止へ変換する。 */
export const promptDlcApproval: ApprovalPrompt = async (permission, signal) => {
	const cancellation = new vscode.CancellationTokenSource();
	const abort = () => cancellation.cancel();
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) {
		abort();
	}
	try {
		const choices = approvalChoices(permission);
		while (!signal.aborted) {
			const selected = await vscode.window.showQuickPick(
				choices,
				{ title: `DLC: ${permission.title}`, ignoreFocusOut: true },
				cancellation.token,
			);
			if (selected === undefined || selected.option !== undefined) {
				return selected?.option;
			}
			await showApprovalDetails(permission);
		}
		return undefined;
	} finally {
		signal.removeEventListener("abort", abort);
		cancellation.dispose();
	}
};

/** 操作対象を先に表示し、作業ルートで入力内容を押し出さない。 */
function approvalChoices(permission: Permission) {
	const input =
		permission.command ?? fileTarget(permission) ?? permission.title;
	const detail = input.replaceAll("\n", " ");
	const description = permission.fields?.find(
		(field) => field.id === "scope",
	)?.value;
	const options = permission.options.map((option) => ({
		label: option.name,
		detail,
		...(description === undefined ? {} : { description }),
		option,
	}));
	return [
		{
			label: "実行条件と入力内容を確認",
			detail: "作業ルート・権限・入力の全文を開きます。",
			option: undefined,
		},
		...options,
	];
}

/** SDK が絶対パスへ正規化した入力も、作業ルートからの位置を先に示す。 */
function fileTarget(permission: Permission): string | undefined {
	const input = permission.fields?.find(
		(field) => field.id === "params",
	)?.value;
	if (input === undefined) {
		return undefined;
	}
	try {
		const params: unknown = JSON.parse(input);
		if (!isRecord(params) || typeof params.path !== "string") {
			return input;
		}
		return permission.cwd === undefined
			? params.path
			: relative(permission.cwd, params.path);
	} catch {
		return input;
	}
}

/** 表示用の文書を編集しても、固定済みのツール入力や承認結果は変わらない。 */
async function showApprovalDetails(permission: Permission): Promise<void> {
	const values = [
		permission.title,
		`作業ルート: ${permission.cwd ?? "指定なし"}`,
		...(permission.command === undefined
			? []
			: [`コマンド:\n${permission.command}`]),
		...(permission.fields ?? []).map(
			(field) => `${field.label}:\n${field.value}`,
		),
		...(permission.details ?? []).map(
			(field) => `${field.label}:\n${field.value}`,
		),
	];
	const document = await vscode.workspace.openTextDocument({
		language: "plaintext",
		content: values.join("\n\n"),
	});
	await vscode.window.showTextDocument(document, { preview: true });
}

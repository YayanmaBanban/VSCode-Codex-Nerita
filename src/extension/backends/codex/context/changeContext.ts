// 固定のGit引数で差分を読み、巨大な差分は要約に切り替えて参照資料にする。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
	changeScopes,
	type ChangeScope,
} from "../../../../shared/changeReferences";
import type { AdditionalContext } from "./additionalContext";

const exec = promisify(execFile);
const limit = 60_000;

/** Gitの生出力を漏らさず、参照の解除や再試行を案内する。 */
export class ChangeContextError extends Error {
	/** 対象範囲と復旧方法を表示する。 */
	constructor(scope: ChangeScope) {
		super(
			`${changeScopes[scope].name}を読み込めませんでした。Gitリポジトリ・コミット${scope === "branch" ? "・mainブランチ" : ""}・nerita.codex.changes.exclude設定を確認するか、参照を外して再送してください。`,
		);
	}
}

/** シェルを介さず、出力サイズと実行時間を制限する。 */
async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec("git", args, {
		cwd,
		encoding: "utf8",
		windowsHide: true,
		timeout: 15_000,
		maxBuffer: 2_000_000,
	});
	return stdout;
}

/** 設定された外部diffやtextconvを実行せず、同じ範囲の差分と統計を取得する。 */
export async function readChangeContext(
	cwd: string,
	scope: ChangeScope,
): Promise<string> {
	try {
		// cwdを指定してフォルダー設定も解決し、取得のたびに最新値を使う。
		const excluded = vscode.workspace
			.getConfiguration("nerita.codex", vscode.Uri.file(cwd))
			.get<unknown>("changes.exclude", []);
		if (
			!Array.isArray(excluded) ||
			!excluded.every(
				(pattern): pattern is string =>
					typeof pattern === "string" &&
					pattern.length > 0 &&
					!pattern.includes("\0"),
			)
		) {
			throw new Error("Invalid changes.exclude");
		}
		const refs = diffRefs(scope);
		const paths = [
			"--",
			":(top)**",
			...excluded.map((pattern) => `:(top,exclude,glob)${pattern}`),
		];
		const args = [
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-color",
			"--no-renames",
			...refs,
		];
		const summary = await git(cwd, [
			...args,
			"--stat",
			"--stat-width=100",
			...paths,
		]);
		const header = `Changes: ${changeScopes[scope].name}\nWorking directory: ${cwd}\nScope: ${changeScopes[scope].description}\n${excluded.length ? "Configured exclusion patterns are applied." : "No path exclusions are applied."} Binary contents are omitted.\n\n`;
		let patch: string;
		try {
			patch = await git(cwd, [
				...args,
				"--patch",
				"--unified=3",
				...paths,
			]);
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !==
				"ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
			) {
				throw error;
			}
			return `${header}[Diff too large; summary only]\n${summary.slice(
				0,
				limit,
			)}${summary.length > limit ? "\n[Summary truncated]" : ""}`;
		}
		if (patch.length > limit) {
			return `${header}[Diff too large; summary only]\n${summary.slice(
				0,
				limit,
			)}${summary.length > limit ? "\n[Summary truncated]" : ""}`;
		}
		return header + (patch || "No changes in this scope.");
	} catch {
		throw new ChangeContextError(scope);
	}
}

/** 重複する範囲は一度だけ取得し、差分を信頼しない参照資料として渡す。 */
export async function changeContext(
	cwd: string,
	scopes: ChangeScope[],
): Promise<AdditionalContext> {
	const context: AdditionalContext = {};
	for (const scope of new Set(scopes)) {
		context[`git:${scope}`] = {
			kind: "untrusted",
			value: await readChangeContext(cwd, scope),
		};
	}
	return context;
}

/** 参照範囲に対応する固定のGit比較引数を返す。 */
function diffRefs(scope: ChangeScope) {
	if (scope === "staged") {
		return ["--cached"];
	}
	if (scope === "since-last-commit") {
		return ["HEAD"];
	}
	if (scope === "branch") {
		return ["refs/heads/main...HEAD"];
	}
	return [];
}

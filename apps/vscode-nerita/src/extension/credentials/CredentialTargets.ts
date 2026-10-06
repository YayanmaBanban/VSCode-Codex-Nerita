// 承認済みコマンドの固定 URL と Git/npm の接続先メタデータから、資格情報の要求を確定する。
import { fsErrorCode } from "../runtime/FsError";
import {
	isNonZeroNumber,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ToolCall } from "../security/ApprovedToolCall";
import type { CredentialBinding } from "@nerita/shared/credentials";
import type { CredentialRequirement } from "./CredentialProvider";
import { sanitizedNpmConfig } from "../runtime/DevToolConfig";
import { containsPath } from "../security/AgentAccessPolicy";

/** 動的に組み立てる接続先や認証付き URL に、推測で資格情報を注入しない。 */
export async function credentialRequirements(
	call: ToolCall,
	bindings: CredentialBinding[],
	workspace: string,
): Promise<CredentialRequirement[]> {
	const command =
		typeof call.params.command === "string"
			? call.params.command
			: (call.command ?? []).join(" ");
	const targets = commandTargets(command);
	const npm =
		call.tool === "pnpm" &&
		/\b(?:install|add|update|publish|fetch|deploy|dlx)\b/.test(command);
	if (npm) {
		for (const target of await npmTargets(call.cwd)) {
			targets.add(target);
		}
	}
	const git = call.tool === "git" || /(?:^|\s)git(?:\.exe)?\s/.test(command);
	if (git) {
		for (const target of await gitTargets(call.cwd, command, workspace)) {
			targets.add(target);
		}
	}
	return bindings
		.filter((binding) => {
			if (
				![...targets].some(
					(target) =>
						target === binding.match.target ||
						target.startsWith(`${binding.match.target}/`),
				)
			) {
				return false;
			}
			if (binding.match.kind === "npm-registry") {
				return npm;
			}
			if (binding.match.kind === "git-https") {
				return git;
			}
			return true;
		})
		.map((binding) => ({
			kind: binding.match.kind,
			service: binding.match.target.split("/")[0]!,
			target: binding.match.target,
			tool: call.tool,
			operation: operation(npm, git),
			workspace,
		}));
}

function operation(npm: boolean, git: boolean) {
	if (npm) {
		return "npm-network";
	}
	return git ? "git-https" : "command";
}
/** URI のユーザー情報・補間を要求や承認画面へ流さない。 */
function commandTargets(command: string) {
	const targets = new Set<string>();
	for (const value of command.match(/https:\/\/[^\s'"<>;]+/g) ?? []) {
		try {
			const url = new URL(value);
			if (
				url.username === "" &&
				url.password === "" &&
				!/[$`{}]/.test(value)
			) {
				targets.add(url.host);
				targets.add(`${url.host}${url.pathname}`.replace(/\/$/, ""));
			}
		} catch {
			/* 解析できない入力へ資格情報を注入しない。 */
		}
	}
	return targets;
}
/** レジストリ設定だけを使い、ENV 認証参照は展開しない。 */
async function npmTargets(cwd: string) {
	const targets = new Set(["registry.npmjs.org"]);
	for (const path of [join(homedir(), ".npmrc"), join(cwd, ".npmrc")]) {
		for (const match of (await sanitizedNpmConfig(path)).matchAll(
			/(?:^|\n)(?:@[^:]+:)?registry=(https:\/\/[^\n]+)/g,
		)) {
			const url = new URL(match[1]!);
			targets.add(`${url.host}${url.pathname}`.replace(/\/$/, ""));
		}
	}
	return targets;
}

/** リモート名を指定した fetch/pull/push/ls-remote は、ワークスペース内の Git 設定から URL だけを読む。 */
async function gitTargets(cwd: string, command: string, workspace: string) {
	const remotes = new Set<string>();
	for (const match of command.matchAll(
		/(?:^|\s)git(?:\.exe)?\s+(?:fetch|pull|push|ls-remote)\b\s*([^\r\n;|&]*)/g,
	)) {
		const first =
			nonEmptyString(match[1]!.trim().split(/\s/)[0]) ?? "origin";
		if (/^[\w.-]+$/.test(first)) {
			remotes.add(first);
		}
	}
	if (!isNonZeroNumber(remotes.size)) {
		return [];
	}
	const config = join(cwd, ".git/config");
	try {
		if (!containsPath(workspace, await realpath(config))) {
			throw new Error(
				"Git 設定の参照が Workspace 外です。HTTPS URL を指定してください。",
			);
		}
		return remoteUrls(await gitConfigText(config), remotes);
	} catch (error) {
		if (
			fsErrorCode(error) === "ENOENT" ||
			fsErrorCode(error) === "ENOTDIR"
		) {
			return [];
		}
		throw error;
	}
}
/** 外部 include の設定や credential helper は解析・起動しない。 */
function remoteUrls(text: string, names: Set<string>) {
	const targets = new Set<string>();
	let remote = "";
	for (const line of text.split(/\r?\n/)) {
		if (line.trim().startsWith("[")) {
			remote = line.match(/^\s*\[remote\s+"([^"]+)"\]/)?.[1] ?? "";
		}
		const url =
			names.has(remote) &&
			line.match(/^\s*(?:url|pushurl)\s*=\s*(https:\/\/\S+)\s*$/)?.[1];
		if (url !== undefined && url !== false) {
			for (const target of commandTargets(url)) {
				targets.add(target);
			}
		}
	}
	return [...targets];
}
/** Git メタデータの読込みにも上限を設ける。 */
async function gitConfigText(path: string) {
	const handle = await open(path, "r");
	try {
		if ((await handle.stat()).size > 64 * 1024) {
			throw new Error("Git 設定が大きすぎます。");
		}
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

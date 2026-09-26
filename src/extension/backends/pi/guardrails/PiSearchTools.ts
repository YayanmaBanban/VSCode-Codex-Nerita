// 検索は Host の読取りだけで行い、workspace 内の検索プログラムを起動しない。
import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { WorkspacePathPolicy } from "../../../security/WorkspacePathPolicy";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../../security/ApprovedToolCall";
import { createPiReadTool } from "./PiReadTools";
import { matchPath } from "../../../security/GuardrailGlob";

const inputSchema = z
	.object({
		pattern: z.string().min(1).max(256),
		path: z.string().default("."),
		limit: z.number().int().min(1).max(200).default(100),
	})
	.strict();

/** grep は文字列検索、find は glob 検索として公開する。 */
export function createPiSearchTools(
	sdk: typeof PiSdk,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
): PiSdk.ToolDefinition[] {
	return (["grep", "find"] as const).map((kind) => ({
		name: kind,
		label: kind,
		description:
			kind === "grep"
				? "Search for a literal string using Host read operations. Does not execute commands. Skips links and files larger than 1 MB. Scans at most 200 files; results may be partial."
				: "Find file paths by glob using Host read operations. Skips links, .git and node_modules. Scans at most 200 files; results may be partial.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				path: { type: "string" },
				limit: { type: "number" },
			},
			required: ["pattern"],
		},
		async execute(id, raw, signal, update, context) {
			const input = inputSchema.parse(raw);
			const combined = AbortSignal.any([
				lifetime,
				...(signal ? [signal] : []),
			]);
			const root = await paths.resolve(input.path, "read");
			const files = await searchFiles(root, paths, authorize, combined);
			const read = createPiReadTool(
				sdk,
				"read",
				paths,
				authorize,
				combined,
			);
			const output: string[] = [];
			for (const file of files) {
				combined.throwIfAborted();
				const name = relative(root, file).replaceAll("\\", "/") || file;
				if (kind === "find") {
					output.push(...matchingName(input.pattern, name));
				} else {
					const result = await read.execute(
						id,
						{ path: file },
						combined,
						update,
						context,
					);
					const text = result.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n");
					output.push(
						...matchingLines(
							text,
							input.pattern,
							name,
							input.limit - output.length,
						),
					);
				}
				if (output.length >= input.limit) {
					break;
				}
			}
			return {
				content: [
					{
						type: "text",
						text:
							output.join("\n") || "No matches in scanned files.",
					},
				],
				details: { scanned: files.length, bounded: true },
			};
		},
	}));
}

/** 一覧を開くたびにガードを通し、リンク先と大きなツリーを辿らない。 */
async function searchFiles(
	root: string,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	signal: AbortSignal,
): Promise<string[]> {
	const pending = [root];
	const files: string[] = [];
	let visited = 0;
	while (pending.length && visited++ < 1000 && files.length < 200) {
		const path = pending.pop()!;
		signal.throwIfAborted();
		const permit = await approveToolCall(
			{
				tool: "ls",
				cwd: paths.cwd,
				params: { path },
				policy: paths.policy,
			},
			authorize,
			signal,
		);
		consumeApprovedToolCall(permit);
		if ((await realpath(path)) !== path) {
			throw new Error("検索対象が変更されました。");
		}
		const info = await lstat(path);
		if (info.isSymbolicLink()) {
			continue;
		}
		if (info.isFile()) {
			files.push(...smallFile(path, info.size));
		}
		if (info.isDirectory()) {
			const entries = await readdir(path, { withFileTypes: true });
			permit.signal.throwIfAborted();
			pending.push(
				...entries
					.filter(
						(entry) =>
							!entry.isSymbolicLink() &&
							![".git", "node_modules"].includes(entry.name),
					)
					.slice(0, 1000 - pending.length)
					.map((entry) => join(path, entry.name)),
			);
		}
	}
	return files;
}

/** glob が一致した名前だけを返す。 */
function matchingName(pattern: string, name: string): string[] {
	return matchPath(pattern, name) ? [name] : [];
}

/** 大きなファイルを検索の読取り対象から外す。 */
function smallFile(path: string, size: number): string[] {
	return size <= 1024 * 1024 ? [path] : [];
}

/** 文字列の一致を検索し、表示量を制限した行だけを返す。 */
function matchingLines(
	text: string,
	pattern: string,
	name: string,
	limit: number,
): string[] {
	return text
		.split("\n")
		.flatMap((line, index) =>
			line.includes(pattern)
				? [`${name}:${index + 1}:${line.slice(0, 400)}`]
				: [],
		)
		.slice(0, limit);
}

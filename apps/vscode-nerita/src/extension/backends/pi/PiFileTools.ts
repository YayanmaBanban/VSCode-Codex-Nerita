// SDK の `write/edit` 形式を維持し、承認済み `path`・内容だけを Host の `operations` へ渡す。

import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	freezeToolCall,
	type ToolCall,
} from "../../security/ApprovedToolCall";
import {
	type FileSnapshot,
	snapshotFile,
	verifyFileSnapshot,
} from "../../security/FileSnapshot";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { evaluateTrust } from "../../security/trust/TrustGate";

const writeSchema = z.object({ path: z.string().min(1), content: z.string() });
const editSchema = z.object({
	path: z.string().min(1),
	edits: z
		.array(z.object({ oldText: z.string(), newText: z.string() }))
		.min(1),
});

/** 各呼出しに専用 `operations` を作り、別の承認の対象を共有しない。 */
export function createPiFileTool(
	sdk: typeof PiSdk,
	kind: "write" | "edit",
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
): ToolDefinition {
	const factory =
		kind === "write"
			? sdk.createWriteToolDefinition
			: sdk.createEditToolDefinition;
	const {
		renderCall: _renderCall,
		renderResult: _renderResult,
		...definition
	} = factory(paths.cwd);
	return {
		...definition,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			return await executePiFileTool(
				kind,
				params,
				signal,
				lifetime,
				paths,
				authorize,
				sdk,
				id,
				update,
				context,
			);
		},
	};
}

/** 呼び出しごとに承認を求め、実際に入出力する直前にも検査する。 */
async function executePiFileTool(
	kind: "write" | "edit",
	params: Parameters<ToolDefinition["execute"]>[1],
	signal: AbortSignal | undefined,
	lifetime: AbortSignal,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	sdk: typeof PiSdk,
	id: string,
	update: Parameters<ToolDefinition["execute"]>[3],
	context: PiSdk.ExtensionToolContext,
) {
	const input = freezeToolCall(
		(kind === "write" ? writeSchema : editSchema).parse(params),
	);
	const combined = signal ? AbortSignal.any([signal, lifetime]) : lifetime;
	combined.throwIfAborted();
	const snapshot = await snapshotFile(paths, input.path);
	const approved = await approveToolCall(
		{
			tool: kind,
			params: { ...input, path: snapshot.path },
			file: snapshot,
			cwd: paths.cwd,
			policy: paths.policy,
		},
		authorize,
		combined,
	);
	const call = consumeApprovedToolCall(approved);
	/** 入出力の直前にも検査し、SDK の変更処理のキューで待つ間にファイルが差し替えられていないか確認する。 */
	const check = async () => {
		approved.signal.throwIfAborted();
		await verifyFileSnapshot(paths, snapshot);
		await evaluateTrust(call);
		approved.signal.throwIfAborted();
	};
	/** 開いた既存ファイルの `identity` 確認後にだけ切り詰め、新規ファイルは排他的に作る。 */
	const write = createApprovedFileWriter(snapshot, check, approved);
	const tool: Omit<ToolDefinition, "renderCall" | "renderResult"> =
		kind === "write"
			? sdk.createWriteToolDefinition(paths.cwd, {
					operations: {
						writeFile: write,
						mkdir: async (dir) => {
							if (dir !== dirname(snapshot.path)) {
								throw new Error(
									"承認対象外のディレクトリです。",
								);
							}
							await check();
							await mkdir(dir, { recursive: true });
						},
					},
				})
			: sdk.createEditToolDefinition(paths.cwd, {
					operations: {
						writeFile: write,
						readFile: async (path) => {
							if (path !== snapshot.path) {
								throw new Error("承認対象外のファイルです。");
							}
							await check();
							return readFile(path);
						},
						access: async (path) => {
							if (path !== snapshot.path) {
								throw new Error("承認対象外のファイルです。");
							}
							await check();
						},
					},
				});
	await check();
	return tool.execute(id, call.params, approved.signal, update, context);
}

/** 検査したファイルの実体を保持し、切り詰めの直前に再確認する。 */
function createApprovedFileWriter(
	snapshot: FileSnapshot,
	check: () => Promise<void>,
	approved: Readonly<{
		call: ToolCall;
		fingerprint: string;
		signal: AbortSignal;
	}>,
) {
	return async (path: string, content: string) => {
		if (path !== snapshot.path) {
			throw new Error("承認対象外のファイルです。");
		}
		await check();
		const handle = await open(path, snapshot.file ? "r+" : "wx");
		try {
			const info = await handle.stat();
			if (
				info.nlink > 1 ||
				(snapshot.file &&
					(info.ino !== snapshot.file.ino ||
						info.dev !== snapshot.file.dev ||
						info.birthtimeMs !== snapshot.file.birthtimeMs))
			) {
				throw new Error("ファイルが差し替えられました。");
			}
			approved.signal.throwIfAborted();
			await handle.truncate(0);
			await handle.writeFile(content, "utf8");
		} finally {
			await handle.close();
		}
	};
}

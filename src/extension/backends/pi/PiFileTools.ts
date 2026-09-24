// ファイルツールはworkspace内のcanonical pathだけを操作し、承認待ちの差し替えも再検査する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../../shared/validation";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../security/ApprovedToolCall";
import { type WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { piFileOperations, withApprovedFileCall } from "./PiFileOperations";

/** SDK内部のファイル操作ごとにも検証を置き、write/editの迂回を防ぐ。 */
export function createPiFileTools(
	sdk: typeof PiSdk,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
): PiSdk.ToolDefinition[] {
	const {
		readFile,
		access,
		writeFile,
		detectImageMimeType,
		mkdir,
		stat,
		readdir,
	} = piFileOperations(paths, lifetime);
	const tools = [
		sdk.createReadToolDefinition(paths.cwd, {
			operations: { readFile, access, detectImageMimeType },
		}),
		sdk.createLsToolDefinition(paths.cwd, {
			operations: {
				exists: async (path) => {
					try {
						await access(path);
						return true;
					} catch (error) {
						if (
							(error as NodeJS.ErrnoException).code === "ENOENT"
						) {
							return false;
						}
						throw error;
					}
				},
				stat,
				readdir,
			},
		}),
		sdk.createWriteToolDefinition(paths.cwd, {
			operations: {
				writeFile,
				mkdir,
			},
		}),
		sdk.createEditToolDefinition(paths.cwd, {
			operations: { readFile, access, writeFile },
		}),
	];
	return tools.map((tool) =>
		protectFileTool(
			tool as PiSdk.ToolDefinition,
			paths,
			authorize,
			lifetime,
		),
	);
}

/** 副作用は毎回承認を維持し、読み取りもworkspace外はdenyする。 */
export function protectFileTool(
	tool: PiSdk.ToolDefinition,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
): PiSdk.ToolDefinition {
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			if (!isRecord(params)) {
				throw new Error("Tool引数が不正です。");
			}
			const combined = signal
				? AbortSignal.any([signal, lifetime])
				: lifetime;
			combined.throwIfAborted();
			const operation =
				tool.name === "write" || tool.name === "edit"
					? "write"
					: "read";
			const input = params.path ?? (tool.name === "ls" ? "." : undefined);
			if (typeof input !== "string") {
				throw new Error("ファイルパスが必要です。");
			}
			const path = await paths.resolve(input, operation);
			const approved = await approveToolCall(
				{
					tool: tool.name,
					params: { ...params, path },
					cwd: paths.cwd,
					policy: paths.policy,
				},
				authorize,
				combined,
			);
			const call = consumeApprovedToolCall(approved);
			if (
				(await paths.resolve(input, operation)) !== path ||
				(await paths.resolve(path, operation)) !== path
			) {
				throw new Error(
					"承認中にパスが変更されました。再承認が必要です。",
				);
			}
			approved.signal.throwIfAborted();
			return withApprovedFileCall(approved.signal, path, call.tool, () =>
				tool.execute(id, call.params, approved.signal, update, context),
			);
		},
	};
}

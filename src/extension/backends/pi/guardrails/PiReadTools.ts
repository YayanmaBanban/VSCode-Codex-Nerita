// SDK の read / ls に共通 Guard を挟み、承認した実体だけを読み取る。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { open, realpath, readdir, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../../security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	freezeToolCall,
} from "../../../security/ApprovedToolCall";
import type { WorkspacePathPolicy } from "../../../security/WorkspacePathPolicy";

/** 読取り内容は検査したハンドルから一度だけ取得し、SDK に同じバッファを渡す。 */
export function createPiReadTool(
	sdk: typeof PiSdk,
	kind: "read" | "ls",
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
): PiSdk.ToolDefinition {
	const factory =
		kind === "read"
			? sdk.createReadToolDefinition
			: sdk.createLsToolDefinition;
	const {
		renderCall: _call,
		renderResult: _result,
		...definition
	} = factory(paths.cwd);
	return {
		...definition,
		async execute(id, params, signal, update, context) {
			const input = freezeToolCall(
				z.record(z.string(), z.unknown()).parse(params),
			);
			const requested = z
				.string()
				.min(1)
				.parse(input.path ?? (kind === "ls" ? "." : undefined));
			const target = await paths.resolve(requested, "read");
			const permit = await approveToolCall(
				{
					tool: kind,
					params: { ...input, path: requested },
					cwd: paths.cwd,
					policy: paths.policy,
				},
				authorize,
				AbortSignal.any([lifetime, ...(signal ? [signal] : [])]),
			);
			const approved = consumeApprovedToolCall(permit);
			if (approved.guardrailsPaths?.[0] !== target) {
				throw new Error(
					"検査中に読取り対象が変更されました。再承認が必要です。",
				);
			}
			const check = async () => {
				permit.signal.throwIfAborted();
				if (
					(await paths.resolve(requested, "read")) !== target ||
					(await realpath(target)) !== target
				) {
					throw new Error(
						"読取り対象が変更されました。再承認が必要です。",
					);
				}
				permit.signal.throwIfAborted();
			};
			await check();
			let tool:
				| ReturnType<typeof sdk.createReadToolDefinition>
				| ReturnType<typeof sdk.createLsToolDefinition>;
			if (kind === "read") {
				const handle = await open(target, "r");
				let content: Buffer;
				try {
					await check();
					const actual = await handle.stat();
					const expected = await lstat(target);
					if (
						!actual.isFile() ||
						actual.ino !== expected.ino ||
						actual.dev !== expected.dev
					) {
						throw new Error("読取り対象が差し替えられました。");
					}
					content = await handle.readFile();
				} finally {
					await handle.close();
				}
				tool = sdk.createReadToolDefinition(paths.cwd, {
					operations: {
						access: () => {
							permit.signal.throwIfAborted();
							return Promise.resolve();
						},
						readFile: () => Promise.resolve(content),
						detectImageMimeType: () =>
							Promise.resolve(imageMime(content)),
					},
				});
			} else {
				tool = sdk.createLsToolDefinition(paths.cwd, {
					operations: {
						exists: async () => {
							await check();
							return true;
						},
						stat: async (path) => {
							await check();
							const child = relative(target, path);
							if (
								child &&
								(child.includes("/") ||
									child.includes("\\") ||
									child === "..")
							) {
								throw new Error("一覧の対象外です。");
							}
							// 子のリンク先へ追従せず、ディレクトリ項目自体の情報だけを使用する。
							return lstat(join(target, child));
						},
						readdir: async () => {
							await check();
							return readdir(target);
						},
					},
				});
			}
			permit.signal.throwIfAborted();
			const result = await (tool as PiSdk.ToolDefinition).execute(
				id,
				{ ...input, path: target },
				permit.signal,
				update,
				context,
			);
			permit.signal.throwIfAborted();
			return result;
		},
	};
}

/** SDK の画像読取りを保ち、拡張子の偽装では画像扱いしない。 */
function imageMime(bytes: Buffer): string | undefined {
	if (
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		return "image/png";
	}
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
		return "image/jpeg";
	}
	if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) {
		return "image/gif";
	}
	if (
		bytes.subarray(0, 4).toString() === "RIFF" &&
		bytes.subarray(8, 12).toString() === "WEBP"
	) {
		return "image/webp";
	}
	return undefined;
}

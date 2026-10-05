// MXC の Host 専用拒否レポートを検証・分類する。stderr 内のパスを信頼してファイルを開かない。
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DenialEvent } from "@nerita/shared/sandboxPolicy";
import type { DevToolPolicy } from "./DevToolPolicy";
import { containsPath } from "../security/AgentAccessPolicy";

const reportSchema = z.object({
	denials: z
		.array(
			z.object({
				resource: z.string().max(32768),
				resourceType: z.enum([
					"file",
					"ui",
					"network",
					"capability",
					"other",
				]),
				accessType: z.enum(["read", "write", "execute", "unknown"]),
			}),
		)
		.max(10000),
	summary: z.object({
		totalDenials: z.number().int().nonnegative(),
		deniedResourcesTruncated: z.boolean(),
	}),
});

/** 空のレポートは「拒否なし」の証明ではない。収集結果をそのまま UI 契約へ渡す。 */
export type DenialReport = {
	events: DenialEvent[];
	truncated: boolean;
	status: "reported" | "empty" | "unavailable";
};

/** 呼出しごとに作った非公開ディレクトリだけを検索する。Sandbox はここへ書けない。 */
export async function readMxcDenials(
	directory: string,
	policy: DevToolPolicy,
): Promise<DenialReport> {
	const names = (await readdir(directory)).filter((name) =>
		/^denials\.[\w-]+\.json$/.test(name),
	);
	if (names.length === 0) {
		return { events: [], truncated: false, status: "unavailable" };
	}
	if (names.length !== 1) {
		throw new Error("MXC 拒否レポートを一意に特定できません。");
	}
	const path = join(directory, names[0]!);
	if (
		(await realpath(path)) !== path ||
		(await stat(path)).size > 8 * 1024 * 1024
	) {
		throw new Error("MXC 拒否レポートが不正です。");
	}
	const report = reportSchema.parse(JSON.parse(await readFile(path, "utf8")));
	if (report.summary.totalDenials !== report.denials.length) {
		throw new Error("MXC 拒否レポートの件数が一致しません。");
	}
	return {
		events: report.denials.map((denial) => classifyDenial(denial, policy)),
		truncated: report.summary.deniedResourcesTruncated,
		status: report.denials.length ? "reported" : "empty",
	};
}

/** 既知のリソース以外は未分類のまま提示する。推定した分類を根拠に実行を許可しない。 */
function classifyDenial(
	denial: z.infer<typeof reportSchema>["denials"][number],
	policy: DevToolPolicy,
): DenialEvent {
	const known =
		denial.resourceType === "file"
			? policy.resources
					.filter(
						(resource) =>
							resource.kind !== "environment" &&
							containsPath(resource.target, denial.resource),
					)
					.sort((a, b) => b.target.length - a.target.length)[0]
			: undefined;
	return {
		id: randomUUID(),
		target: denial.resource,
		resourceType: denial.resourceType,
		requestedAccess: denial.accessType,
		...(known
			? {
					resource: {
						...known,
						target: denial.resource,
						access: "deny",
						source: "denial",
					},
					estimatedTool: known.tool,
				}
			: {}),
	};
}

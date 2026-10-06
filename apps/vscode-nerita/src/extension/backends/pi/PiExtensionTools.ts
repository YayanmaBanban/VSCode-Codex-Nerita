// 初回と動的登録に同じ許可・承認処理を適用し、組み込み名の上書きを防ぐ。
import type { Extension } from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { createPiHostShellTool } from "./PiHostShellTool";
import {
	piToolExposure,
	piToolPermitted,
	type PiToolFeatures,
} from "./PiToolFeatures";
import type { PiWebTrust } from "./PiWebTrust";
import { protectPiFeatureTool } from "./PiFeatureToolResults";

const reserved = new Set([
	"read",
	"ls",
	"write",
	"edit",
	"powershell",
	"pwsh",
	"bash",
	"grep",
	"find",
	"subagent",
	"subagent_job",
	"subagent_workflow",
	"codemode",
	"tool_search",
]);

/** SDK が保持する Map の登録口で、ロード後の `registerTool` も検証する。 */
export function guardPiExtensionTools(
	extension: Extension,
	cwd: string,
	authorize: PiAuthorize,
	policy: AgentAccessPolicy | undefined,
	signal: AbortSignal,
	features: PiToolFeatures,
	webTrust: PiWebTrust[],
): void {
	const tools = extension.tools;
	const set = tools.set.bind(tools);
	const register = (
		name: string,
		registration: Parameters<typeof tools.set>[1],
	) => {
		features.registry?.add(name);
		return set(name, registration);
	};
	const entries = [...tools];
	tools.clear();
	tools.set = (name, registration) => {
		if (!piToolPermitted(name, features)) {
			return tools;
		}
		const builtin =
			isBuiltin(extension.path, name) ||
			extension.path === "<inline:nerita-mcp>";
		if (builtin) {
			return register(name, registration);
		}
		const shell =
			process.platform !== "win32" && name === "bash"
				? policy
				: undefined;
		if (reserved.has(name) && !shell) {
			throw new Error(
				`Pi拡張による組み込みToolの上書きは拒否されました: ${name}`,
			);
		}
		const definition = shell
			? createPiHostShellTool(
					registration.definition,
					cwd,
					authorize,
					shell,
					signal,
				)
			: approvePiTool(
					registration.definition,
					cwd,
					authorize,
					policy,
					signal,
					webTrust.find((item) => item.entry === extension.path)
						?.check,
				);
		return register(name, {
			...registration,
			definition: protectPiFeatureTool(
				piToolExposure(definition, features),
				features,
			),
		});
	};
	for (const [name, tool] of entries) {
		tools.set(name, tool);
	}
}

/** 外部拡張が組み込みの名前を騙って登録することを防ぐ。 */
function isBuiltin(path: string, name: string): boolean {
	return (
		(path === "<inline:nerita-codemode>" && name === "codemode") ||
		(path === "<inline:nerita-tool-search>" && name === "tool_search")
	);
}

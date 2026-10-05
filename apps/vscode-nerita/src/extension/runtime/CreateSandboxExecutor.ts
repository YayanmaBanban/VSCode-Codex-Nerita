// Pi の組み立て側には SDK を公開せず、能力検査を通った実行基盤だけを返す。
import { probeMxc } from "./MxcAvailability";
import { loadMxcSdk } from "./MxcSdk";
import { MxcExecutor } from "./MxcExecutor";
import { dockerAvailability } from "./SandboxBackend";
import type { DenialReport } from "./MxcDenials";
import type { ResourcePolicy } from "@nerita/shared/sandboxPolicy";

/** 起動検査に失敗した場合は理由を返し、別バックエンドや Host を起動しない。 */
export async function createSandboxExecutor(
	backend: "mxc" | "docker",
	extensionPath: string,
	cwd: string,
	signal: AbortSignal,
	onDenials?: (report: DenialReport) => void,
	onPolicy?: (resources: ResourcePolicy[]) => void,
) {
	const availability =
		backend === "docker"
			? dockerAvailability
			: await probeMxc(extensionPath, cwd, signal);
	signal.throwIfAborted();
	const executor = availability.available
		? new MxcExecutor(
				await loadMxcSdk(extensionPath),
				availability.isolationTier ?? "processcontainer",
				onDenials,
				onPolicy,
			)
		: null;
	return { executor, availability };
}

// Runtime の起動前に Host の信頼コンテキストを固定し、子には親の上限を引き継ぐ。
import { WorkspaceTrustStore } from "../../security/trust/WorkspaceTrustStore";
import { bindTrustContext } from "../../security/trust/TrustGate";
import type { PiRuntimeOptions } from "./PiRuntime";

/** 保存先の注入がない起動も既定では未信頼とする。 */
export function preparePiTrust(options: PiRuntimeOptions) {
	const store =
		options.trustStore ??
		new WorkspaceTrustStore({
			read: () => undefined,
			write: async () => {},
		});
	const enabled =
		options.trustEnabled ?? (() => options.workspaceTrusted === true);
	const binding = bindTrustContext(store, [options.cwd], enabled);
	return {
		dispose: binding.dispose,
		options: {
			...options,
			trustStore: store,
			trustContextId: options.parentPolicy?.trustContextId ?? binding.id,
			signal: AbortSignal.any([options.signal, store.signal]),
		},
	};
}

/** VS Code と root の両方が信頼済みのときだけ起動時の実行準備を許可する。 */
export async function piWorkspaceTrusted(
	options: PiRuntimeOptions,
): Promise<boolean> {
	return (
		(options.trustEnabled?.() ?? options.workspaceTrusted === true) &&
		!!options.trustStore &&
		(await options.trustStore.trusted(options.cwd))
	);
}

/** 未信頼のセッションは履歴を workspace へ書かず、保存先変更による再接続ループも防ぐ。 */
export async function restrictPiStorage(
	options: PiRuntimeOptions,
): Promise<PiRuntimeOptions> {
	if (await piWorkspaceTrusted(options)) {
		return options;
	}
	if (options.resume?.storage === "workspace") {
		throw new Error("workspace内の履歴を再開するにはTrust操作が必要です。");
	}
	return { ...options, storage: "global", getStorage: () => "global" };
}

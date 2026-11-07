// OS の保存先を持たず、適用済みガードレールと承認失効を製品の Registry で検証する。
import { join } from "node:path";
import { defaultGuardrails } from "@nerita/shared/guardrails/config";
import type { PrivacyConfig } from "@nerita/shared/guardrails/privacy";
import { GuardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";
import { PiEgressGuard } from "../../apps/vscode-nerita/src/extension/backends/pi/guardrails/PiEgressGuard";

/** 各ケースは独立した適用設定を持ち、未保存の下書きを検査へ混ぜない。 */
export function privacyFixture() {
	const root = join(process.cwd(), "privacy-workspace");
	const registry = new GuardrailRegistry();
	const guard = new PiEgressGuard(() => {
		const active = registry.snapshot(root, [root]);
		return {
			config: active.config.privacy,
			revision: active.digest,
			signal: active.signal,
		};
	});
	return {
		guard,
		registry,
		root,
		apply(privacy: PrivacyConfig) {
			registry.apply(root, { ...defaultGuardrails(), privacy });
		},
	};
}

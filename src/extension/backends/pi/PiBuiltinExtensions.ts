// Nerita 組み込み拡張は VSIX 内から注入し、ワークスペースの `.pi/extensions` へ書き込まない。
import type {
	ExtensionFactory,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { PiProviderControls } from "./PiProviderControls";

/** 設定を注入しない利用側では通常の Pi 要求を維持する。 */
export const neritaProviderExtension: ExtensionFactory = (pi) => {
	pi.on("before_provider_request", () => undefined);
};

/** プロバイダー固有の要求変換を行う、名前付きの組み込み拡張を作る。 */
export function neritaExtensionFactories(
	controls?: PiProviderControls,
): InlineExtension[] {
	return [
		{
			name: "nerita-provider-controls",
			factory: controls
				? (pi) => {
						pi.on("before_provider_request", (event, context) =>
							controls.rewrite(event.payload, context.model),
						);
					}
				: neritaProviderExtension,
		},
	];
}

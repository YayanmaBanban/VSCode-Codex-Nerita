// Nerita組み込み拡張はVSIX内から注入し、workspaceの.pi/extensionsへ書き込まない。
import type {
	ExtensionFactory,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { PiProviderControls } from "./PiProviderControls";

/** 設定を注入しない利用側では通常のPi要求を維持する。 */
export const neritaProviderExtension: ExtensionFactory = (pi) => {
	pi.on("before_provider_request", () => undefined);
};

/** SDKの通常探索を維持したまま、名前付き組み込み拡張を追加する。 */
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

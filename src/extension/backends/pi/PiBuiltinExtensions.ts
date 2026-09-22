// Nerita組み込み拡張はVSIX内から注入し、workspaceの.pi/extensionsへ書き込まない。
import type {
	ExtensionFactory,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";

/** Phase 8のprovider controls用の入口。基盤段階では要求を書き換えない。 */
export const neritaProviderExtension: ExtensionFactory = (pi) => {
	pi.on("before_provider_request", () => undefined);
};

/** SDKの通常探索を維持したまま、名前付き組み込み拡張を追加する。 */
export function neritaExtensionFactories(): InlineExtension[] {
	return [
		{ name: "nerita-provider-controls", factory: neritaProviderExtension },
	];
}

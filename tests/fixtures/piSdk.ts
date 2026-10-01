// 実行ごとに生成した配布用 SDK を読み込み、古い開発ビルドへの依存を防ぐ。
import { pathToFileURL } from "node:url";
import type { PiFeatureSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiBuiltinExtensions";

/** 準備に失敗した実行を、別の生成物へ切り替えて成功させない。 */
export async function loadTestPiSdk(): Promise<PiFeatureSdk> {
	const entry = process.env.NERITA_TEST_PI_ENTRY;
	if (!entry) {
		throw new Error(
			"SDK の準備が必要です。pnpm test:integration から実行してください。",
		);
	}
	return import(
		/* @vite-ignore */ pathToFileURL(entry).href
	) as Promise<PiFeatureSdk>;
}

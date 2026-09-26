// VS Code を起動せずに Host の通信・状態遷移を検証する。
import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["tests/unit/hostSetup.ts"],
		include: [
			"tests/unit/**/*.test.ts",
			"tests/contract/**/*.test.ts",
			"tests/integration/**/*.test.ts",
		],
		restoreMocks: true,
	},
});

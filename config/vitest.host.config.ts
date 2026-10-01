// VS Code を起動せずに Host の通信・状態遷移を検証する。
import { defineConfig } from "vitest/config";
import { regressionMutation } from "./regression-mutation";
export default defineConfig({
	plugins: regressionMutation(),
	test: {
		environment: "node",
		allowOnly: false,
		passWithNoTests: false,
		setupFiles: ["tests/unit/hostSetup.ts"],
		include: [
			"tests/unit/**/*.test.ts",
			"tests/contract/**/*.test.ts",
			"tests/integration/**/*.test.ts",
		],
		restoreMocks: true,
	},
});

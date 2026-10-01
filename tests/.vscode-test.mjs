import { extensionRoot } from "../config/workspace-paths.cjs";
import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testRoot = process.env.NERITA_TEST_ROOT;
if (!testRoot) {
	throw new Error("pnpm test または pnpm test:vsix から実行してください。");
}

export default defineConfig({
	files: fileURLToPath(
		new URL("../out/tests/extension.test.js", import.meta.url),
	),
	extensionDevelopmentPath:
		process.env.NERITA_TEST_EXTENSION_PATH ?? extensionRoot,
	useInstallation: process.env.VSCODE_EXECUTABLE
		? { fromPath: process.env.VSCODE_EXECUTABLE }
		: undefined,
	launchArgs: [
		`--user-data-dir=${path.join(testRoot, "profile")}`,
		`--extensions-dir=${path.join(testRoot, "extensions")}`,
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-extensions",
	],
	mocha: { timeout: 20000, forbidOnly: true, forbidPending: true },
});

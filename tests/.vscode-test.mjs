import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "node:url";

export default defineConfig({
	files: fileURLToPath(
		new URL("../out/tests/extension.test.js", import.meta.url),
	),
	extensionDevelopmentPath: fileURLToPath(new URL("..", import.meta.url)),
	useInstallation: process.env.VSCODE_EXECUTABLE
		? { fromPath: process.env.VSCODE_EXECUTABLE }
		: undefined,
	launchArgs: [
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-extensions",
	],
	mocha: { timeout: 20000 },
});

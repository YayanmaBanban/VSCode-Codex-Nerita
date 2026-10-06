// 保存元のプロセスと状態を共有せず、本番のコントローラーで履歴を復元する。
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import { createPiRuntime } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";

/** 親から渡された専用領域と履歴 ID だけを使う。 */
async function main() {
	const input = z
		.looseObject({
			cwd: z.string(),
			agentDir: z.string(),
			sessionId: z.string(),
			output: z.string(),
		})
		.parse(JSON.parse(await readFile(process.argv[2]!, "utf8")));
	const trustStore = new WorkspaceTrustStore({
		read: () => undefined,
		write: () => Promise.resolve(),
	});
	await trustStore.setUserTrust(input.cwd, true);
	const controller = new PiSessionController(
		async (signal, authorize, resume) => ({
			cwd: input.cwd,
			session: await createPiRuntime({
				cwd: input.cwd,
				agentDir: input.agentDir,
				extensionPath: process.env.NERITA_TEST_EXTENSION!,
				preferredModel: { provider: "local", model: "test-model" },
				signal,
				authorize,
				...(resume ? { resume } : {}),
				executor: null,
				workspaceRoots: [input.cwd],
				workspaceTrusted: true,
				trustStore,
				storage: "workspace",
			}),
		}),
	);
	try {
		await controller.connect();
		await controller.receive({ type: "session/list", requestId: "list" });
		await controller.receive({
			type: "session/load",
			requestId: "load",
			sessionId: input.sessionId,
		});
		await writeFile(input.output, JSON.stringify(controller.snapshot()));
	} finally {
		await controller.dispose();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});

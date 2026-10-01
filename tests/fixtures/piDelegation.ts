// ローカルモデルと実 Runtime を接続し、子の副作用と保存を一時領域で観測する。
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { guardrailsFixture } from "../piGuardrailsFixture";
import { loadTestPiSdk } from "./piSdk";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import {
	createPiRuntime,
	type PiRuntimeOptions,
	type PiRuntimeSession,
} from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";

/** モデルだけをローカル HTTP に置き換え、起動・承認・保存は本番経路を使う。 */
export async function piDelegation() {
	await loadTestPiSdk();
	const h = await guardrailsFixture();
	const abort = new AbortController();
	const sessions: PiRuntimeSession[] = [];
	const trustStore = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	const cleanup = async () => {
		abort.abort();
		try {
			await Promise.all(sessions.map((session) => session.close()));
		} finally {
			await h.close();
			await removeFixture(h.root);
		}
	};
	try {
		await trustStore.setUserTrust(h.cwd, true);
		await mkdir(join(h.agentDir, "agents"));
		for (const name of ["worker", "reviewer"]) {
			await writeFile(
				join(h.agentDir, "agents", `${name}.md`),
				`---\nname: ${name}\ndescription: fixture\ntools: read, write\nsystemPromptMode: replace\n---\nDELEGATION_CHILD_${name}`,
			);
		}
	} catch (error) {
		await cleanup();
		throw error;
	}
	const options: PiRuntimeOptions = {
		extensionPath: dirname(
			dirname(dirname(process.env.NERITA_TEST_PI_ENTRY!)),
		),
		cwd: h.cwd,
		agentDir: h.agentDir,
		signal: abort.signal,
		preferredModel: { provider: "local", model: "guard" },
		executor: null,
		storage: "workspace",
		trustStore,
		workspaceTrusted: true,
		authorize: (_presentation, signal) =>
			Promise.resolve(signal ?? abort.signal),
	};
	const open = async (changes: Partial<PiRuntimeOptions> = {}) => {
		const session = await createPiRuntime({ ...options, ...changes });
		sessions.push(session);
		return session;
	};
	return { ...h, options, abort, trustStore, open, cleanup };
}

/** 検証用に作成した一時領域だけを回収する。 */
async function removeFixture(root: string) {
	if (
		dirname(root) !== tmpdir() ||
		!basename(root).startsWith("nerita-guard-integration-")
	) {
		throw new Error("検証データの削除先が不正です。");
	}
	await rm(root, { recursive: true, force: true });
}

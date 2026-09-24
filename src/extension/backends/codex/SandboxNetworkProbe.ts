// readinessだけで通信遮断を保証せず、固定の無害な接続検査でfail closedする。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ToolCall } from "../../security/ApprovedToolCall";
import type { SandboxConnection } from "./CodexSandboxExecutor";
import type { CommandExecParams } from "./codex-app-server/v2/CommandExecParams";

/** 通信隔離の未確認を報告する。loopbackの実装上の制約とFirewall設定の不備は判別しない。 */
export class SandboxNetworkUnavailableError extends Error {
	constructor() {
		super(
			"Windows Sandboxの通信隔離を確認できません。localhostを含む通信遮断の検証に通らなかったため、要求されたコマンドは実行していません。",
		);
		this.name = "SandboxNetworkUnavailableError";
	}
}

/** agent入力を含めず、credentialも送らず、Hostの一時listenerだけへ接続を試す。 */
export async function verifySandboxNetwork(
	client: SandboxConnection,
	call: ToolCall,
): Promise<void> {
	const executable = join(
		process.env.SystemRoot || "C:\\Windows",
		"System32/curl.exe",
	);
	const parameters: Omit<CommandExecParams, "command"> = {
		cwd: call.cwd,
		timeoutMs: 4000,
		env: { ...call.env },
		sandboxPolicy: { type: "readOnly", networkAccess: false },
	};
	// 検査ツール自体の起動失敗を「通信が遮断された」と誤認しない。
	const version = await client.executeCommand({
		...parameters,
		command: [executable, "-q", "--version"],
	});
	if (version.exitCode !== 0 || !version.stdout.startsWith("curl ")) {
		throw new SandboxNetworkUnavailableError();
	}
	let reached = false;
	const nonce = randomUUID();
	const server = createServer((_request, response) => {
		reached = true;
		response.writeHead(200, {
			"Content-Type": "text/plain",
			Connection: "close",
		});
		response.end(nonce);
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new SandboxNetworkUnavailableError();
		}
		const result = await client.executeCommand({
			...parameters,
			command: [
				executable,
				"-q",
				"--silent",
				"--show-error",
				"--noproxy",
				"*",
				"--connect-timeout",
				"1",
				"--max-time",
				"2",
				`http://127.0.0.1:${address.port}/${nonce}`,
			],
		});
		if (reached || ![7, 28].includes(result.exitCode)) {
			throw new SandboxNetworkUnavailableError();
		}
		// 接続拒否やtimeoutはFirewallによる遮断の証明ではない。
		// IPv6・外部通信・実行中の設定変更もこのprobeでは保証できない。
		throw new SandboxNetworkUnavailableError();
	} finally {
		server.closeAllConnections();
		if (server.listening) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}
}

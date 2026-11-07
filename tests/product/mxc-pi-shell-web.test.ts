// Pi の実シェルで動的な UA を置換し、実際の受信ヘッダーと副作用のない拒否を確認する。
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";
import { piFixture, send, permission, finished, until } from "../support/pi";

void test("Pi の Web cmdlet と curl は実行時の UA を設定値へ置き換え、本文と他のヘッダーを保持する", async (t) => {
	const { f, server } = await shellWebFixture(t);
	const command = `
$private = 'private' + '@example.invalid'
Invoke-WebRequest -UseBasicParsing -Uri '${server.url}/iwr' -UserAgent $private -Headers @{'User-Agent'=$private; 'X-Probe'='iwr'} | Out-Null
$request = @{ Uri = '${server.url}/irm'; UserAgent = $private; Headers = @{'uSeR-aGeNt'=$private; 'X-Probe'='irm'} }
irm @request | Out-Null
curl.exe -sSA$private -H "User-Agent: $private" -H 'X-Probe: curl' --data '-A-body-preserved' '${server.url}/curl' --next -sS --user-agent=$private --header="User-Agent: $private" '${server.url}/next'
`;
	f.model.replies.push(
		{ name: "powershell", arguments: { command } },
		"取得完了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "Web コマンドを実行");
	await until(
		() =>
			controller.snapshot().permissions.length > 0 ||
			controller.snapshot().tools.at(-1)?.status === "failed",
		() => controller.snapshot(),
	);
	assert.equal(
		controller.snapshot().permissions.length,
		1,
		JSON.stringify(controller.snapshot()),
	);
	assert.deepEqual(server.requests, [], "承認前は HTTP を送信しない");
	await permission(controller, "accept");
	const state = await finished(controller);

	assert.equal(state.tools.at(-1)?.exitCode, 0, JSON.stringify(state.tools));
	assert.deepEqual(
		server.requests,
		[
			{
				path: "/iwr",
				userAgent: "ResearchClient/2.0",
				probe: "iwr",
				body: "",
			},
			{
				path: "/irm",
				userAgent: "ResearchClient/2.0",
				probe: "irm",
				body: "",
			},
			{
				path: "/curl",
				userAgent: "ResearchClient/2.0",
				probe: "curl",
				body: "-A-body-preserved",
			},
			{
				path: "/next",
				userAgent: "ResearchClient/2.0",
				probe: undefined,
				body: "",
			},
		],
		`動的な UA を置換して各リクエストを保持する: ${JSON.stringify(state.tools)}`,
	);
});

for (const option of ["--config 'curl.conf'", "--header '@headers.txt'"]) {
	void test(`Pi の curl は検査できない外部ヘッダー指定を送信前に拒否する（${option}）`, async (t) => {
		const { f, server } = await shellWebFixture(t);
		await writeFile(
			join(f.cwd, "curl.conf"),
			`user-agent = "private@example.invalid"\nurl = "${server.url}/leak"\n`,
		);
		await writeFile(
			join(f.cwd, "headers.txt"),
			"User-Agent: private@example.invalid\n",
		);
		const command = `Invoke-RestMethod -Uri '${server.url}/control' | Out-Null; curl.exe ${option} '${server.url}/leak'`;
		f.model.replies.push(
			{ name: "powershell", arguments: { command } },
			"拒否を確認",
		);
		const controller = f.controller();
		await controller.connect();
		await send(controller, "外部ヘッダー指定を確認");
		await permission(controller, "accept");
		const state = await finished(controller);

		assert.notEqual(
			state.tools.at(-1)?.exitCode,
			0,
			`検査できない外部ヘッダー指定は拒否する: ${JSON.stringify(state.tools)}`,
		);
		assert.deepEqual(
			server.requests,
			[
				{
					path: "/control",
					userAgent: "ResearchClient/2.0",
					probe: undefined,
					body: "",
				},
			],
			`実行経路が動作しても検査できないヘッダーは送信しない: ${JSON.stringify(state.tools)}`,
		);
	});
}

void test("Pi のシェル承認待ち中に UA 設定を変更すると送信しない", async (t) => {
	const { f, server, configPath } = await shellWebFixture(t);
	const command = `Invoke-RestMethod -Uri '${server.url}/changed'`;
	f.model.replies.push(
		{ name: "powershell", arguments: { command } },
		"変更を確認",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "設定変更を確認");
	await until(() => controller.snapshot().permissions.length > 0);
	await writeFile(
		configPath,
		JSON.stringify({ fetchContent: { userAgent: "ChangedClient/3.0" } }),
	);
	await permission(controller, "accept");
	const state = await finished(controller);

	assert.equal(
		state.tools.at(-1)?.status,
		"failed",
		"UA 設定が変わった承認は再利用しない",
	);
	assert.deepEqual(server.requests, []);
});

/** 一時ユーザー設定と MXC を接続し、ホストのローカル HTTP だけをテスト対象にする。 */
async function shellWebFixture(t: TestContext) {
	const f = await piFixture(t);
	assert.ok(isNonEmptyString(process.env.PI_CODING_AGENT_DIR));
	await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	const configPath = join(process.env.PI_CODING_AGENT_DIR, "web-search.json");
	await writeFile(
		configPath,
		JSON.stringify({ fetchContent: { userAgent: "ResearchClient/2.0" } }),
	);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	f.options.parentPolicy = {
		workspaceRoots: [f.cwd],
		writableRoots: [f.cwd],
		shell: true,
		networkAccess: true,
		hostLoopbackAccess: true,
	};
	const server = await webServer(t);
	return { f, server, configPath };
}

/** 実行プロセスから実際に到着したヘッダーと本文だけを記録する。 */
async function webServer(t: TestContext) {
	const requests: {
		path: string | undefined;
		userAgent: string | undefined;
		probe: string | string[] | undefined;
		body: string;
	}[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk: Buffer) => {
			body += String(chunk);
		});
		request.on("end", () => {
			requests.push({
				path: request.url,
				userAgent: request.headers["user-agent"],
				probe: request.headers["x-probe"],
				body,
			});
			response.writeHead(200, { "Content-Type": "text/plain" });
			response.end("ok");
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(async () => {
		const closed = once(server, "close");
		server.closeAllConnections();
		server.close();
		await closed;
	});
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
	return { requests, url: `http://127.0.0.1:${address.port}` };
}

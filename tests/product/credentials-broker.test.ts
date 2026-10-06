// 組み込み Provider の外部応答だけを置き換え、承認順序・参照制約・注入の回収を確認する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { piFixture } from "../support/pi";
import { credentialFixture } from "../support/credentials";
import { CredentialBroker } from "../../apps/vscode-nerita/src/extension/credentials/CredentialBroker";
import { BindingStore } from "../../apps/vscode-nerita/src/extension/credentials/BindingStore";
import {
	CredentialProviderRegistry,
	type CredentialRequirement,
} from "../../apps/vscode-nerita/src/extension/credentials/CredentialProvider";
import {
	BitwardenSecretsProvider,
	GitCredentialProvider,
	NpmConfigProvider,
} from "../../apps/vscode-nerita/src/extension/credentials/BuiltinCredentialProviders";
import { SecretValue } from "../../apps/vscode-nerita/src/extension/credentials/CredentialStore";
import { CredentialStream } from "../../apps/vscode-nerita/src/extension/credentials/CredentialStream";
import { prepareCredentialInjection } from "../../apps/vscode-nerita/src/extension/credentials/CredentialInjection";
import { CommandPermissions } from "../../apps/vscode-nerita/src/extension/runtime/CommandPermissions";
import {
	credentialBindingSchema,
	type CredentialBinding,
} from "../../packages/shared/src/credentials";
import { credentialRequirements } from "../../apps/vscode-nerita/src/extension/credentials/CredentialTargets";
import { createWorkspaceAccessPolicy } from "../../apps/vscode-nerita/src/extension/security/WorkspacePathPolicy";

const secretId = "2863ced6-eba1-48b4-b5c0-afa30104877a";
const projectId = "2863ced6-eba1-48b4-b5c0-afa30104877b";
const binding = credentialBindingSchema.parse({
	id: "api",
	match: { kind: "api-token", target: "api.example.test" },
	provider: { type: "bitwarden-secrets-manager", secretId, projectId },
	injection: { type: "env", name: "FIXTURE_API_TOKEN" },
});

void test(
	"BWS は inspect で取得せず、承認後の単一 ID 取得と projectId 検証だけを行う",
	verifyBwsBroker,
);

/** 実際のブローカーへ取得前の拒否と取り消しを通す。 */
async function verifyBwsBroker(t: TestContext) {
	const f = await piFixture(t);
	const storage = credentialFixture();
	await storage.stores.memory.set(
		"bws.auth.default",
		new SecretValue("bws-auth-private"),
	);
	const calls: string[][] = [];
	let wrongProject = false;
	const provider = new BitwardenSecretsProvider(
		storage.stores.memory,
		(_name, args, _workspace, _signal, input, env) => {
			calls.push(args);
			assert.equal(input, undefined);
			assert.deepEqual(env, { BWS_ACCESS_TOKEN: "bws-auth-private" });
			assert.ok(
				!args.includes("--access-token") && !args.includes("list"),
			);
			return Promise.resolve(
				JSON.stringify({
					id: secretId,
					projectId: wrongProject ? secretId : projectId,
					value: "api-private",
				}),
			);
		},
	);
	const bindings = new BindingStore(f.cwd);
	await bindings.update(() => [binding]);
	const grants = new CommandPermissions({
		read: () => [],
		write: () => Promise.resolve(),
	});
	const broker = new CredentialBroker(
		bindings,
		new CredentialProviderRegistry([provider]),
		storage.stores.redactor,
		grants,
	);
	const requirement = required(f.cwd, binding);
	const signal = new AbortController().signal;
	assert.equal(
		(await provider.inspect(requirement, binding, signal)).length,
		1,
	);
	assert.equal(calls.length, 0);
	await assert.rejects(
		broker.acquire(
			requirement,
			"mxc",
			() => Promise.reject(new Error("cancel")),
			signal,
		),
	);
	assert.equal(calls.length, 0);
	const entry = await broker.acquire(
		requirement,
		"mxc",
		async (presentation) => {
			assert.equal(calls.length, 0, "承認前に Provider を起動しない");
			assert.ok(!JSON.stringify(presentation).includes("api-private"));
			await grants.allow(presentation.commandPermission!, "session");
			return grants.signal(presentation.commandPermission!);
		},
		signal,
	);
	assert.equal(entry.lease.scope, "session");
	await verifyLeaseDisposal(entry, grants, signal);
	wrongProject = true;
	await assert.rejects(
		broker.acquire(
			requirement,
			"mxc",
			() => Promise.resolve(signal),
			signal,
		),
		/所属/,
	);
	assert.equal(calls.length, 2);
}

void test(
	"承認中の Binding 変更は取得を拒否し、保存済みの旧許可を再利用しない",
	verifyBindingChange,
);

/** 承認待ちの間に変わった参照で取得しない。 */
async function verifyBindingChange(t: TestContext) {
	const f = await piFixture(t);
	const storage = credentialFixture();
	let calls = 0;
	const provider = new BitwardenSecretsProvider(storage.stores.memory, () => {
		calls++;
		return Promise.resolve("");
	});
	const bindings = new BindingStore(f.cwd);
	await bindings.update(() => [binding]);
	const broker = new CredentialBroker(
		bindings,
		new CredentialProviderRegistry([provider]),
		storage.stores.redactor,
	);
	const signal = new AbortController().signal;
	await assert.rejects(
		broker.acquire(
			required(f.cwd, binding),
			"host",
			async () => {
				await bindings.update(replaceReference);
				return signal;
			},
			signal,
		),
		/Binding が変更/,
	);
	assert.equal(calls, 0);
}

/** 設定変更の対象となる非秘密参照を組み立てる。 */
function replaceReference(items: CredentialBinding[]): CredentialBinding[] {
	return items.map((item) => ({
		...item,
		provider: {
			type: "bitwarden-secrets-manager",
			accountId: "default",
			secretId: projectId,
		},
	}));
}

/** Provider の固定要求とスコープ付き注入を外部境界で確認する。 */
async function verifyProtocolProviders(t: TestContext) {
	const f = await piFixture(t);
	const signal = new AbortController().signal;
	const gitBinding = credentialBindingSchema.parse({
		id: "git",
		match: { kind: "git-https", target: "github.com/team" },
		provider: { type: "git" },
		injection: { type: "git-https" },
	});
	const git = new GitCredentialProvider(
		(name, args, _workspace, _signal, input, env) => {
			assert.equal(name, "git");
			assert.deepEqual(args, ["credential", "fill"]);
			assert.equal(
				input,
				"protocol=https\nhost=github.com\npath=team\n\n",
			);
			assert.equal(env?.GIT_TERMINAL_PROMPT, "0");
			return Promise.resolve(
				"username=fixture-user\npassword=git-private\n\n",
			);
		},
	);
	const [gitCandidate] = await git.inspect(
		required(f.cwd, gitBinding),
		gitBinding,
		signal,
	);
	const gitMaterial = await git.acquire(gitCandidate!, signal);
	assert.equal(
		gitMaterial.secret.use((value) => value),
		"git-private",
	);
	gitMaterial.secret.dispose();
	gitMaterial.username?.dispose();
	await verifyNpmInjection(f, signal);
}

void test("秘密値がチャンク境界をまたいでも、逐次出力に断片を残さない", () => {
	const storage = credentialFixture();
	storage.stores.redactor.protect("secret-long-marker");
	const output: string[] = [];
	const stream = new CredentialStream(storage.stores.redactor, (text) =>
		output.push(text),
	);
	stream.write(`${"開始 ".repeat(100)}secret-`);
	stream.write("long-marker 終了");
	stream.end();
	assert.equal(output.join(""), `${"開始 ".repeat(100)}[REDACTED] 終了`);
	assert.ok(output.length > 1, "正常な出力は実行終了まで待たずに通知する");
});

void test("重なる秘密値は登録順・チャンクの分割位置にかかわらず一致区間全体を保護する", () => {
	const secrets = ["ABCDEFGHIJKLM", "HIJKLMN"];
	const text = `ABCDEFGHIJKLMN${"x".repeat(18)}`;
	for (const order of [secrets, [...secrets].reverse()]) {
		const storage = credentialFixture();
		order.forEach((value) => storage.stores.redactor.protect(value));
		assert.equal(
			storage.stores.redactor.text(text),
			`[REDACTED]${"x".repeat(18)}`,
		);
		for (let boundary = 0; boundary <= text.length; boundary++) {
			const output: string[] = [];
			const stream = new CredentialStream(
				storage.stores.redactor,
				(value) => output.push(value),
			);
			stream.write(text.slice(0, boundary));
			stream.write(text.slice(boundary));
			stream.end();
			assert.equal(
				output.join(""),
				`[REDACTED]${"x".repeat(18)}`,
				`split=${boundary}`,
			);
		}
	}
});

/** 要求は Host が確定した対象・用途・ワークスペースだけを含む。 */
function required(
	workspace: string,
	item: CredentialBinding,
): CredentialRequirement {
	return {
		workspace,
		kind: item.match.kind,
		target: item.match.target,
		service: item.match.target.split("/")[0]!,
		tool: "powershell",
		operation: "command",
	};
}
/** レジストリ別の ENV 参照を、Binding を変更せず実行時だけ解決する。 */
async function verifyNpmInjection(
	f: Awaited<ReturnType<typeof piFixture>>,
	signal: AbortSignal,
) {
	const config = join(f.root, "host.npmrc");
	await writeFile(
		config,
		"registry=https://npm.example.test/\n//npm.example.test/:_authToken=${FIXTURE_NPM_TOKEN}\n//other.example.test/:_authToken=unrelated-private\n",
	);
	const npmBinding = credentialBindingSchema.parse({
		id: "npm",
		match: { kind: "npm-registry", target: "npm.example.test" },
		provider: { type: "npmrc" },
		injection: { type: "npm-auth-token" },
	});
	const npm = new NpmConfigProvider(config, {
		FIXTURE_NPM_TOKEN: "npm-private",
	});
	const [candidate] = await npm.inspect(
		required(f.cwd, npmBinding),
		npmBinding,
		signal,
	);
	const material = await npm.acquire(candidate!, signal);
	const storage = credentialFixture();
	const bindings = new BindingStore(f.cwd);
	await bindings.update(() => [npmBinding]);
	const broker = new CredentialBroker(
		bindings,
		new CredentialProviderRegistry([npm]),
		storage.stores.redactor,
	);
	const entry = await broker.acquire(
		required(f.cwd, npmBinding),
		"mxc",
		() => Promise.resolve(signal),
		signal,
	);
	const injection = await prepareCredentialInjection([entry], signal);
	try {
		const text = await readFile(
			injection.env.NPM_CONFIG_USERCONFIG!,
			"utf8",
		);
		assert.match(text, /\/\/npm.example.test\/:_authToken=npm-private/);
		assert.ok(
			!text.includes("unrelated-private") &&
				!text.includes("FIXTURE_NPM_TOKEN"),
		);
	} finally {
		material.secret.dispose();
		await injection.dispose();
	}
}
/** 取消し済みの資格情報は使えず、専用設定も実行終了時に消える。 */
async function verifyLeaseDisposal(
	entry: Awaited<ReturnType<CredentialBroker["acquire"]>>,
	grants: CommandPermissions,
	signal: AbortSignal,
) {
	const injection = await prepareCredentialInjection([entry], signal);
	assert.equal(injection.env.FIXTURE_API_TOKEN, "api-private");
	assert.equal(injection.env.BWS_ACCESS_TOKEN, undefined);
	assert.ok(!JSON.stringify(binding).includes("api-private"));
	await grants.revoke(grants.list()[0]!.permission);
	assert.throws(() => entry.lease.use(() => {}));
	const temporary = injection.directory;
	await injection.dispose();
	await assert.rejects(stat(temporary), { code: "ENOENT" });
}

void test(
	"Git は HTTPS の対象だけを資格情報プロトコルへ渡し、npm は該当レジストリの設定だけを注入する",
	verifyProtocolProviders,
);

void test("Git remote の固定 URL を要求へ解決し、ヘルパーは承認した対象以外へ資格情報を返さない", async (t) => {
	const f = await piFixture(t);
	const storage = credentialFixture();
	const signal = new AbortController().signal;
	await mkdir(join(f.cwd, ".git"));
	await writeFile(
		join(f.cwd, ".git/config"),
		'[remote "origin"]\n url = https://github.com/team/repo.git\n[remote "other"]\n url = https://elsewhere.example.test/repo.git\n',
	);
	const gitBinding = credentialBindingSchema.parse({
		id: "git",
		match: { kind: "git-https", target: "github.com/team" },
		provider: { type: "git" },
		injection: { type: "git-https" },
	});
	const requirements = await credentialRequirements(
		{
			tool: "powershell",
			params: { command: "git fetch origin" },
			cwd: f.cwd,
			policy: await createWorkspaceAccessPolicy([f.cwd]),
		},
		[gitBinding],
		f.cwd,
	);
	assert.deepEqual(
		requirements.map((item) => item.target),
		["github.com/team"],
	);
	const bindings = new BindingStore(f.cwd);
	await bindings.update(() => [gitBinding]);
	const provider = new GitCredentialProvider(() =>
		Promise.resolve("username=fixture-user\npassword=git-private\n\n"),
	);
	const broker = new CredentialBroker(
		bindings,
		new CredentialProviderRegistry([provider]),
		storage.stores.redactor,
	);
	const entry = await broker.acquire(
		requirements[0]!,
		"mxc",
		() => Promise.resolve(signal),
		signal,
	);
	const injection = await prepareCredentialInjection([entry], signal);
	const script = join(injection.directory, "askpass.cjs");
	try {
		const invoke = promisify(execFile);
		const result = await invoke(
			process.execPath,
			[script, "Password for 'https://github.com/team/repo.git':"],
			{ env: injection.env, windowsHide: true },
		);
		assert.equal(result.stdout, "git-private");
		await assert.rejects(
			invoke(
				process.execPath,
				[
					script,
					"Password for 'https://elsewhere.example.test/repo.git':",
				],
				{ env: injection.env, windowsHide: true },
			),
		);
		assert.ok(!(await readFile(script, "utf8")).includes("git-private"));
	} finally {
		await injection.dispose();
	}
});

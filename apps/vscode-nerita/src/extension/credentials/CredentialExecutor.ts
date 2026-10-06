// 実行承認の後で資格情報を取得し、注入・出力保護・回収を同じ実行の寿命にする。
import type { ToolAuthorizer } from "../security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	issueApprovedToolCall,
	type ApprovedToolCall,
	type ToolCall,
} from "../security/ApprovedToolCall";
import type {
	SandboxCommandExecutor,
	SandboxCommandOutput,
} from "../runtime/SandboxCommandExecutor";
import type { AgentAccessPolicy } from "../security/AgentAccessPolicy";
import type { CredentialBroker } from "./CredentialBroker";
import {
	prepareCredentialInjection,
	type CredentialInjectionEntry,
	type CredentialInjection,
} from "./CredentialInjection";
import type { CredentialRequirement } from "./CredentialProvider";
import { CredentialStream } from "./CredentialStream";
import { credentialRequirements } from "./CredentialTargets";

/** Binding のある既知の対象だけに要求を作り、Provider をモデルへ公開しない。 */
export class CredentialExecutor implements SandboxCommandExecutor {
	constructor(
		private readonly executor: SandboxCommandExecutor,
		private readonly broker: CredentialBroker,
		private readonly authorize: ToolAuthorizer,
	) {}
	describe(policy: AgentAccessPolicy) {
		return (
			this.executor.describe?.(policy) ?? { name: "Sandbox", details: [] }
		);
	}
	async execute(approved: ApprovedToolCall, output?: SandboxCommandOutput) {
		const call = consumeApprovedToolCall(approved);
		const entries: CredentialInjectionEntry[] = [];
		let injection: CredentialInjection | undefined;
		try {
			for (const requirement of await this.requirements(call)) {
				entries.push(
					await this.broker.acquire(
						requirement,
						call.hostShell === true ? "host" : "mxc",
						this.authorize,
						approved.signal,
					),
				);
			}
			injection = await prepareCredentialInjection(
				entries,
				approved.signal,
			);
			const stdout = new CredentialStream(this.broker.redactor, (text) =>
				output?.("stdout", text),
			);
			const stderr = new CredentialStream(this.broker.redactor, (text) =>
				output?.("stderr", text),
			);
			const result = await this.executor.execute(
				issueApprovedToolCall(call, injection.signal),
				(stream, text) =>
					(stream === "stdout" ? stdout : stderr).write(text),
				injection,
			);
			stdout.end();
			stderr.end();
			const safe = {
				...result,
				stdout: this.broker.redactor.text(result.stdout),
				stderr: this.broker.redactor.text(result.stderr),
			};
			return safe;
		} catch {
			throw new Error(
				approved.signal.aborted
					? "資格情報を使用する実行を停止しました。"
					: "資格情報を使用する実行に失敗しました。Binding・認証・承認を確認してください。",
			);
		} finally {
			entries.forEach((entry) => entry.lease.dispose());
			await injection?.dispose();
		}
	}
	private async requirements(
		call: ToolCall,
	): Promise<CredentialRequirement[]> {
		return credentialRequirements(
			call,
			await this.broker.bindings.read(),
			this.broker.bindings.root,
		);
	}
}

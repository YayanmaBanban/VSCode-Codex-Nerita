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
	/** 資格情報の取得と確認 UI を実行経路へ結び付け、コマンド承認とは別に使用許可を確認する。 */
	constructor(
		private readonly executor: SandboxCommandExecutor,
		private readonly broker: CredentialBroker,
		private readonly authorize: ToolAuthorizer,
	) {}
	/** 実行方式の説明は注入した実行器へ委ね、資格情報を表示の詳細に含めない。 */
	describe(policy: AgentAccessPolicy) {
		return (
			this.executor.describe?.(policy) ?? { name: "Sandbox", details: [] }
		);
	}
	/** 秘密値の利用承認後に注入し、出力を保護してから公開する。失敗や停止でも秘密値と一時注入を回収する。 */
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
	/** 実際の呼出しとルートの参照設定を照合し、その実行で必要な資格情報だけを求める。 */
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

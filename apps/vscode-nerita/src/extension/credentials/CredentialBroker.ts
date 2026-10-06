// Binding と実行要求を照合し、既存の承認ストアで資格情報だけの許可を得てから取得する。
import { createHash } from "node:crypto";
import type { CommandPermissions } from "../runtime/CommandPermissions";
import type {
	CommandPermissionKey,
	CommandApprovalScope,
} from "@nerita/shared/commandPermission";
import type { ToolAuthorizer } from "../security/ApprovalGuard";
import { type BindingStore } from "./BindingStore";
import {
	type CredentialProviderRegistry,
	type CredentialMaterial,
	type CredentialRequirement,
} from "./CredentialProvider";
import { type SecretRedactor } from "./CredentialStore";
import type { CredentialBinding } from "@nerita/shared/credentials";

/** 設定変更後は保存済み許可が一致しないよう、参照を承認キーへ含める。 */
function credentialPermission(
	requirement: CredentialRequirement,
	route: CommandPermissionKey["route"],
	binding: CredentialBinding,
): CommandPermissionKey {
	const digest = createHash("sha256")
		.update(JSON.stringify(binding))
		.digest("hex");
	return {
		tool: `credential:${JSON.stringify([requirement.tool, requirement.operation, requirement.kind, requirement.target, digest])}`,
		commandClass: "execution",
		workspace: requirement.workspace,
		route,
	};
}

/** 承認画面に表示するのは利用先と参照元だけ。 */
function credentialApproval(
	requirement: CredentialRequirement,
	binding: CredentialBinding,
	permission: CommandPermissionKey,
): Parameters<ToolAuthorizer>[0] {
	return {
		title: "資格情報の利用承認",
		cwd: requirement.workspace,
		commandPermission: permission,
		fields: [
			{
				id: "credential-target",
				label: "対象",
				value: `${requirement.kind}: ${requirement.target}`,
				display: "text",
			},
			{
				id: "credential-provider",
				label: "Provider",
				value: binding.provider.type,
				display: "text",
			},
			{
				id: "credential-operation",
				label: "用途",
				value: `${requirement.tool}: ${requirement.operation}`,
				display: "text",
			},
		],
	};
}

export type ApprovalScope = "process" | Exclude<CommandApprovalScope, "once">;
/** scope は承認の再利用範囲。秘密値そのものは全 scope で1実行だけ保持する。 */
export class CredentialLease {
	private disposed = false;
	constructor(
		readonly requirement: CredentialRequirement,
		readonly material: CredentialMaterial,
		readonly scope: ApprovalScope,
		readonly signal: AbortSignal,
	) {}
	use<T>(action: (material: CredentialMaterial) => T): T {
		this.signal.throwIfAborted();
		if (this.disposed) {
			throw new Error("資格情報の利用期限が終了しました。");
		}
		return action(this.material);
	}
	dispose() {
		this.disposed = true;
		this.material.secret.dispose();
		this.material.username?.dispose();
	}
}

/** コマンド承認とは異なるキーを使い、同じ UI・範囲・取消し・保存処理を再利用する。 */
export class CredentialBroker {
	constructor(
		readonly bindings: BindingStore,
		readonly providers: CredentialProviderRegistry,
		readonly redactor: SecretRedactor,
		readonly grants?: CommandPermissions,
	) {}
	async acquire(
		requirement: CredentialRequirement,
		route: CommandPermissionKey["route"],
		authorize: ToolAuthorizer,
		signal: AbortSignal,
	) {
		const matches = (await this.bindings.read()).filter(
			(binding) =>
				binding.match.kind === requirement.kind &&
				binding.match.target === requirement.target,
		);
		if (matches.length !== 1) {
			throw new Error("対象に一致する Binding を1件設定してください。");
		}
		const binding = matches[0]!;
		const provider = this.providers.get(binding.provider.type);
		const candidates = await provider.inspect(requirement, binding, signal);
		if (candidates.length !== 1) {
			throw new Error("資格情報の候補を確定できません。");
		}
		const permission = credentialPermission(requirement, route, binding);
		const approved = await authorize(
			credentialApproval(requirement, binding, permission),
			signal,
		);
		const combined = AbortSignal.any([signal, approved]);
		combined.throwIfAborted();
		// 承認待ちの間に参照が変わっていたら、取得へ進まず再承認する。
		const current = (await this.bindings.read()).find(
			(item) => item.id === binding.id,
		);
		if (JSON.stringify(current) !== JSON.stringify(binding)) {
			throw new Error("Binding が変更されています。再承認が必要です。");
		}
		const material = await provider.acquire(candidates[0]!, combined);
		try {
			combined.throwIfAborted();
			material.secret.use((value) =>
				protectMaterial(this.redactor, material.type, value),
			);
			material.username?.use((value) => this.redactor.protect(value));
			const scope =
				this.grants
					?.list()
					.find(
						(grant) =>
							JSON.stringify(grant.permission) ===
							JSON.stringify(permission),
					)?.scope ?? "process";
			return {
				lease: new CredentialLease(
					requirement,
					material,
					scope,
					combined,
				),
				binding,
			};
		} catch (error) {
			material.secret.dispose();
			material.username?.dispose();
			throw error;
		}
	}
}
/** npm basic の復号表示も、元のパスワードを露出させない。 */
function protectMaterial(
	redactor: SecretRedactor,
	type: CredentialMaterial["type"],
	value: string,
) {
	redactor.protect(value);
	if (type === "npm-basic") {
		const decoded = Buffer.from(value, "base64").toString("utf8");
		redactor.protect(decoded);
		redactor.protect(decoded.slice(decoded.indexOf(":") + 1));
	}
}

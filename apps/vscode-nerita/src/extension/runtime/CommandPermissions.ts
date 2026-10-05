// Host が承認したキーだけを保持する。保存済みの許可も実行用 permit にはならない。
import {
	commandGrantSchema,
	type CommandGrant,
	type CommandPermissionKey,
	type CommandApprovalScope,
} from "@nerita/shared/commandPermission";

/** 保存先は Host の管理領域。ワークスペース内の設定ファイルを入力にしない。 */
export type CommandGrantStorage = {
	read(): unknown;
	write(grants: CommandGrant[]): Promise<void>;
};

/** ワークスペースは実体パスを渡す。クラス間の大小関係による暗黙の継承は行わない。 */
export class CommandPermissions {
	private readonly grants = new Map<string, CommandGrant>();
	private pending = Promise.resolve();
	private readonly lifetimes = new Map<string, AbortController>();

	constructor(
		private readonly storage: CommandGrantStorage,
		private readonly changed: () => void = () => {},
	) {
		const saved = commandGrantSchema.array().safeParse(storage.read());
		for (const grant of saved.success ? saved.data : []) {
			if (grant.scope === "workspace") {
				this.grants.set(permissionKey(grant.permission), grant);
			}
		}
	}

	/** 呼出し側に内部の可変参照を渡さない。 */
	list(): CommandGrant[] {
		return structuredClone([...this.grants.values()]);
	}

	/** 一致する許可だけを参照し、別 route・workspace・tool・class へ拡張しない。 */
	has(permission: CommandPermissionKey): boolean {
		return this.grants.has(permissionKey(permission));
	}

	/** 取消しを取得済みの承認と実行中のプロセスにも伝える。 */
	signal(permission: CommandPermissionKey): AbortSignal {
		const key = permissionKey(permission);
		let lifetime = this.lifetimes.get(key);
		if (!lifetime) {
			lifetime = new AbortController();
			this.lifetimes.set(key, lifetime);
		}
		return lifetime.signal;
	}

	/** UI で選ばれた範囲だけを記録する。今回だけの承認は再利用できない。 */
	allow(
		permission: CommandPermissionKey,
		scope: CommandApprovalScope,
	): Promise<void> {
		return this.enqueue(async () => {
			if (scope === "once") {
				return;
			}
			const grant = commandGrantSchema.parse({ permission, scope });
			const next = new Map(this.grants);
			next.set(permissionKey(permission), grant);
			await this.persist(next);
		});
	}

	/** 保存に失敗した取消は成功として表示しない。 */
	revoke(permission: CommandPermissionKey): Promise<void> {
		return this.enqueue(async () => {
			const next = new Map(this.grants);
			next.delete(permissionKey(permission));
			await this.persist(next);
			this.invalidate(permissionKey(permission));
		});
	}

	/** 新しい会話を開始したときに呼び、セッション承認を持ち越さない。 */
	clearSession(): Promise<void> {
		return this.enqueue(() => {
			for (const [key, grant] of this.grants) {
				if (grant.scope === "session") {
					this.grants.delete(key);
					this.invalidate(key);
				}
			}
			this.changed();
			return Promise.resolve();
		});
	}

	/** 保存成功後にだけメモリへ公開し、並行する承認・取消の更新を失わない。 */
	private async persist(next: Map<string, CommandGrant>) {
		await this.storage.write(
			structuredClone(
				[...next.values()].filter(
					(grant) => grant.scope === "workspace",
				),
			),
		);
		this.grants.clear();
		for (const [key, grant] of next) {
			this.grants.set(key, grant);
		}
		this.changed();
	}

	/** 次の承認は新しい寿命を持ち、取消済み signal を復活させない。 */
	private invalidate(key: string) {
		this.lifetimes
			.get(key)
			?.abort(new Error("コマンド実行の承認が取り消されました。"));
		this.lifetimes.delete(key);
	}

	/** 直前の失敗が次の操作を永久に止めないよう、待機列と返却する結果を分ける。 */
	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.pending.then(operation);
		this.pending = result.catch(() => {});
		return result;
	}
}

/** 区切り文字を含む入力でも衝突せず、拡張子や任意のコマンド文字列をキーへ加えない。 */
function permissionKey(permission: CommandPermissionKey): string {
	return JSON.stringify([
		permission.tool,
		permission.commandClass,
		permission.workspace,
		permission.route,
	]);
}

// 実行基盤から能力・拒否・リソースを受け取り、管理画面へ秘密値を含まない状態を公開する。
import type { SandboxSnapshot } from "@nerita/shared/sandboxManagement";
import type { ResourcePolicy } from "@nerita/shared/sandboxPolicy";
import {
	CommandPermissions,
	type CommandGrantStorage,
} from "./CommandPermissions";
import { dockerAvailability, type SandboxAvailability } from "./SandboxBackend";
import type { DenialReport } from "./MxcDenials";

/** 同じ Extension Host の Pi と設定パネルで共有する。SDK や VS Code API は保持しない。 */
export class SandboxManagement {
	readonly commands: CommandPermissions;
	private readonly listeners = new Set<() => void>();
	private status: SandboxAvailability = {
		id: "mxc",
		name: "Microsoft MXC",
		available: false,
		reason: "起動検査を実行してください。",
		availableMethods: [],
		uiCapabilities: {},
	};
	private resources: ResourcePolicy[] = [];
	private report: DenialReport | undefined;
	constructor(storage: CommandGrantStorage) {
		this.commands = new CommandPermissions(storage, () => this.changed());
	}
	/** 完了した検査の実際の結果だけを公開する。 */
	availability = (status: SandboxAvailability) => {
		this.status = structuredClone(status);
		this.changed();
	};
	/** 最後の実行で使用した権限を表示し、イベント登録で自動許可しない。 */
	policy = (resources: ResourcePolicy[]) => {
		this.resources = structuredClone(resources);
		this.changed();
	};
	/** 空のレポートも拒否なしの証拠として扱わず、状態を保持する。 */
	denials = (report: DenialReport) => {
		this.report = structuredClone(report);
		this.changed();
	};
	/** 保存先の変更後にパネルが再取得するための通知。 */
	changed() {
		for (const listener of this.listeners) {
			listener();
		}
	}
	/** パネル寿命に従って購読を解除する。 */
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 内部オブジェクトを書き換えられないようコピーを返す。 */
	snapshot(): SandboxSnapshot {
		return structuredClone({
			selected: "mxc",
			availability: [this.status, dockerAvailability],
			grants: this.commands.list(),
			resources: this.resources,
			denials: this.report?.events ?? [],
			reportStatus: this.report?.status ?? "not-run",
		});
	}
}

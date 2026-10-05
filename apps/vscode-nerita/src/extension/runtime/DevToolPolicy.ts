// 開発ツールの権限をワークスペース・ネットワーク・UI の権限から分離し、MXC 固有情報を外へ漏らさない。
import type { ResourcePolicy } from "@nerita/shared/sandboxPolicy";

/** 環境値と実体パスは Host 専用。管理画面には `resources` だけを通知する。 */
export type DevToolPolicy = {
	resources: ResourcePolicy[];
	environment: Record<string, string>;
	executables: Record<string, string>;
};

/** 他の言語のプロファイルも同じリソース型を返す。型に言語別の分岐を足さない。 */
export type DevToolProfile = {
	name: string;
	commands: readonly string[];
	resolve(executable: string): ResourcePolicy[] | Promise<ResourcePolicy[]>;
};

/** モデルの要求から直接構築しない。組み立て側が独立した責務として保持する。 */
export type SandboxPolicy = {
	workspace: { readonlyRoots: string[]; writableRoots: string[] };
	network: { internet: "deny" | "allow"; localhost: "deny" | "allow" };
	ui: { allowWindows: boolean; clipboard: "deny"; inputInjection: "deny" };
	devTools: DevToolPolicy;
};

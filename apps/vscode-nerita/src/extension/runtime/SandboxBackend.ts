// Sandbox の能力情報を SDK の型から切り離し、未実装の選択肢も明示する。

/** Docker は予約値であり、実行要求を受け付けない。 */
export type SandboxBackendId = "mxc" | "docker";

/** available は能力検出だけでなく実プロセスの起動確認に成功した場合だけ真になる。 */
export type SandboxAvailability = {
	id: SandboxBackendId;
	name: string;
	available: boolean;
	reason?: string;
	isolationTier?: string;
	availableMethods: string[];
	uiCapabilities: Record<string, boolean>;
};

export const dockerAvailability: SandboxAvailability = {
	id: "docker",
	name: "Docker",
	available: false,
	reason: "準備中です。Docker Sandbox はまだ実装されていません。",
	availableMethods: [],
	uiCapabilities: {},
};

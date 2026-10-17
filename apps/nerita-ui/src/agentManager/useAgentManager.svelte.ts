// Host の管理状態を購読し、保存要求の世代・応答 ID と失敗時の入力保持を管理する。
import { onMount } from "svelte";
import type {
	ManagerBridge,
	ManagerRequest,
	ManagerReply,
	ManagerState,
} from "@nerita/shared/agentManager/messages";
/** 現在の設定世代を照合してから適用する、エージェント設定の変更要求。 */
type Mutation = Extract<ManagerRequest, { generation: string }>;
/** 保存する内容のみを受け取り、要求 ID と世代は管理画面側で付加する。 */
export type ManagerSave = (
	change: Mutation extends infer T
		? T extends Mutation
			? Omit<T, "id" | "generation" | "workspace">
			: never
		: never,
) => void;
/** Host の状態は変更しないスナップショットとして保持し、編集用の下書きと分ける。 */
export function useAgentManager(
	bridge: ManagerBridge,
	onState?: (state: ManagerState) => void,
) {
	let state = $state.raw<ManagerState>();
	let revision = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);
	let sequence = 0;
	onMount(() => {
		/** 設定を受信した場合や、初期化または現在の保存要求への応答を受けた場合に待機状態を解除する。 */
		const receive = (message: ManagerReply) => {
			if (message.type === "state") {
				state = message;
				revision += 1;
				busy = false;
				onState?.(message);
			} else if (message.id === 0 || message.id === sequence) {
				error = message.error;
				saved = message.id !== 0 && message.error === null;
				busy = false;
			}
		};
		const unsubscribe = bridge.subscribe(receive);
		bridge.postMessage({ type: "ready" });
		return unsubscribe;
	});
	/** 現在の設定世代と要求番号を付けて保存を送り、未取得・要求中の状態では送信しない。 */
	const save: ManagerSave = (change) => {
		if (!state || busy) {
			return;
		}
		busy = true;
		error = null;
		saved = false;
		bridge.postMessage({
			...change,
			id: ++sequence,
			workspace: state.workspace,
			generation: state.generation,
		});
	};
	return {
		get state() {
			return state;
		},
		get revision() {
			return revision;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		get saved() {
			return saved;
		},
		save,
		reload() {
			if (busy) {
				return;
			}
			error = null;
			saved = false;
			busy = true;
			bridge.postMessage({ type: "reload" });
		},
	};
}

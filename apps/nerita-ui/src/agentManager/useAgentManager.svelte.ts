// Host の管理状態を購読し、保存要求の世代・応答 ID と失敗時の入力保持を管理する。
import { onMount } from "svelte";
import { createManagerDraftRequests } from "./managerDraftRequests";
import type {
	ManagerBridge,
	ManagerRequest,
	ManagerReply,
	ManagerState,
} from "@nerita/shared/agentManager/messages";
/** 現在の設定世代を照合してから適用する、エージェント設定の変更要求。 */
type Mutation = Extract<ManagerRequest, { generation: string }>;

/** 初期応答を取り逃さないよう購読後に取得を要求し、画面破棄時の解除処理を返す。 */
function connectManager(
	bridge: ManagerBridge,
	receive: (message: ManagerReply) => void,
	drafts: ReturnType<typeof createManagerDraftRequests>,
) {
	const unsubscribe = bridge.subscribe((message) => {
		if (!drafts.receive(message)) {
			receive(message);
		}
	});
	bridge.postMessage({ type: "ready" });
	return () => {
		unsubscribe();
		drafts.dispose();
	};
}
/** 保存する内容のみを受け取り、要求 ID と世代は管理画面側で付加する。 */
export type ManagerSave = (
	change: Mutation extends infer T
		? T extends Mutation
			? Omit<T, "id" | "generation" | "workspace">
			: never
		: never,
) => void;

/** 画面が取得した保存先・世代と連番を付け、保存要求を Host へ渡す。 */
function postManagerMutation(
	bridge: ManagerBridge,
	state: ManagerState,
	change: Parameters<ManagerSave>[0],
	id: number,
) {
	bridge.postMessage({
		...change,
		id,
		workspace: state.workspace,
		generation: state.generation,
	});
}
/** 候補だけの更新では編集フォームを作り直さず、定義や接続先の変更だけを区別する。 */
function managerStateChanged(
	previous: ManagerState | undefined,
	next: ManagerState,
) {
	if (previous === undefined) {
		return true;
	}
	return (
		previous.activeBackend !== next.activeBackend ||
		previous.generation !== next.generation
	);
}

/** 保存操作の失敗だけでなく、不完全な読み込み結果も再取得が必要な状態として扱う。 */
function managerReloadRequired(
	state: ManagerState | undefined,
	operationFailed: boolean,
) {
	return operationFailed || (state?.errors.length ?? 0) > 0;
}
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
	let reloadRequired = $state(false);
	let sequence = 0;
	const drafts = createManagerDraftRequests(bridge, () => state);
	onMount(() => {
		/** 設定を受信した場合や、初期化または現在の保存要求への応答を受けた場合に待機状態を解除する。 */
		const receive = (message: ManagerReply) => {
			if (message.type === "state") {
				const replaceEditor =
					busy || managerStateChanged(state, message);
				state = message;
				if (replaceEditor) {
					error = null;
					saved = false;
					reloadRequired = false;
					revision += 1;
					busy = false;
					onState?.(message);
				}
			} else if (message.id === 0 || message.id === sequence) {
				error = message.error;
				reloadRequired ||= needsReload(message.error);
				saved = message.id !== 0 && message.error === null;
				busy = false;
			}
		};
		return connectManager(bridge, receive, drafts);
	});
	/** 現在の設定世代と要求番号を付けて保存を送り、未取得・要求中の状態では送信しない。 */
	const save: ManagerSave = (change) => {
		if (!state || busy || managerReloadRequired(state, reloadRequired)) {
			return;
		}
		busy = true;
		error = null;
		saved = false;
		postManagerMutation(bridge, state, change, ++sequence);
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
		get reloadRequired() {
			return managerReloadRequired(state, reloadRequired);
		},
		save,
		writeDraft: drafts.write,
		clearError() {
			if (!managerReloadRequired(state, reloadRequired)) {
				error = null;
			}
		},
		reload() {
			if (busy) {
				return;
			}
			saved = false;
			busy = true;
			bridge.postMessage({ type: "reload" });
		},
	};
}
/** Host が再取得を必要とする失敗を返した場合は、再保存を防ぐ。 */
function needsReload(error: string | null) {
	return error?.includes("再読み込み") === true;
}

// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	type PiAuthItem,
	type PiAuthRequest,
	type PiAuthState,
} from "@nerita/shared/piAuth";

import "../chat/chat.css";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PiAuthEditorProps = {
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type AuthProviderItemProps = {
	item: PiAuthItem;
	open: boolean;
	setExpanded: (value: string | null) => void;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	hostState: PiAuthState;
	send: (request: PiAuthRequest) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type AuthProviderContentProps = {
	item: PiAuthItem;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	hostState: PiAuthState;
	send: (request: PiAuthRequest) => void;
};

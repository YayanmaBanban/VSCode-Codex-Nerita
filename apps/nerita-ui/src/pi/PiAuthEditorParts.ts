// 認証先の一覧・詳細へ渡す状態と、認証要求の送信操作を定義する。

import {
	type PiAuthItem,
	type PiAuthRequest,
	type PiAuthState,
} from "@nerita/shared/piAuth";

import "../chat/chat.css";

/** Host の認証状態と認証要求の送信先を渡し、画面だけで認証結果を確定しない。 */
export type PiAuthEditorProps = {
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
};
/** 認証先の状態・開閉位置と、認証操作の送信先を渡す。 */
export type AuthProviderItemProps = {
	item: PiAuthItem;
	open: boolean;
	setExpanded: (value: string | null) => void;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	hostState: PiAuthState;
	send: (request: PiAuthRequest) => void;
};
/** アカウント一覧・操作結果・入力要求を表示するための認証状態。 */
export type AuthProviderContentProps = {
	item: PiAuthItem;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	hostState: PiAuthState;
	send: (request: PiAuthRequest) => void;
};

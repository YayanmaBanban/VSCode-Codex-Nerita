// 上部オプションメニューから性格設定パネルを開き、Host へ編集操作を送る。

import {
	type ReactNode,
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";

import { CSPProvider } from "@base-ui/react/csp-provider";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import type { BackendId } from "@nerita/shared/backend";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import type { PersonalityMessage } from "@nerita/shared/personality";
import type { SidebarLocation } from "@nerita/shared/sidebar";
import { cn } from "cnfast";
import { Ellipsis, FileUser, KeyRound, LogOut, X } from "lucide-react";

import { SettingsTooltip } from "../SettingsTooltip";
import { BackendMenu } from "../connection/BackendMenu";
import { SidebarMenu } from "../connection/SidebarMenu";
import { PersonalityPane } from "./PersonalityPane";

/** 性格設定・認証・表示先の状態と、設定要求の送信・表示先の選択操作。 */
type PersonalityOptionsProps = {
	backend?: BackendId | undefined;
	state: ChatState;
	send: (message: UiMessage) => void;
	error: string | null;
	sidebarLocation?: SidebarLocation | undefined;
	onSelectSidebar?: ((location: SidebarLocation) => void) | undefined;
};

/** メニューとダイアログのフォーカス管理を Base UI に任せる。 */
export function PersonalityOptions(props: PersonalityOptionsProps) {
	const { state, send, error, sidebarLocation = "secondary" } = props;
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		setPending(false);
	}, [state.personality]);
	useEffect(() => {
		if (error) {
			setPending(false);
		}
	}, [error]);
	const request = (message: PersonalityMessage) => {
		setPending(true);
		send(message);
	};
	return (
		<CSPProvider disableStyleElements>
			<Menu.Root>
				<SettingsTooltip content="オプション">
					<Menu.Trigger
						ref={trigger}
						aria-label="オプション"
						className="inline-flex size-[28px] shrink-0 items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover"
					>
						<Ellipsis size={16} aria-hidden="true" />
					</Menu.Trigger>
				</SettingsTooltip>
				<ChatOptionsMenu
					{...props}
					sidebarLocation={sidebarLocation}
					setOpen={setOpen}
					request={request}
				/>
			</Menu.Root>
			<PersonalityDialog
				open={open}
				setOpen={setOpen}
				trigger={trigger}
				error={error}
				pending={pending}
				state={state}
				request={request}
			/>
		</CSPProvider>
	);
}

/** 表示先・バックエンド・認証の状態と、メニューから実行する設定操作。 */
type ChatOptionsMenuProps = {
	sidebarLocation: SidebarLocation;
	onSelectSidebar?: ((location: SidebarLocation) => void) | undefined;
	send: (message: UiMessage) => void;
	backend?: undefined | "codex" | "pi";
	state: ChatState;
	setOpen: Dispatch<SetStateAction<boolean>>;
	request: (message: PersonalityMessage) => void;
};

/** 表示先・バックエンド・認証と性格設定の操作をまとめる。 */
function ChatOptionsMenu({
	sidebarLocation,
	onSelectSidebar,
	send,
	backend,
	state,
	setOpen,
	request,
}: ChatOptionsMenuProps) {
	return (
		<Menu.Portal>
			<Menu.Positioner
				side="bottom"
				align="end"
				sideOffset={6}
				collisionPadding={8}
				className="z-30"
			>
				<Menu.Popup className="min-w-[180px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px] text-menu-text shadow-[0_6px_24px_#0003]">
					<SidebarMenu
						location={sidebarLocation}
						onSelect={
							onSelectSidebar ??
							((location) =>
								send({
									type: "ui/setSidebar",
									requestId: crypto.randomUUID(),
									location,
								}))
						}
					/>
					<BackendMenu
						backend={backend}
						onSelect={(backend) =>
							send({
								type: "ui/setBackend",
								requestId: crypto.randomUUID(),
								backend,
							})
						}
					/>
					{state.piAccount !== null && (
						<AuthManagementMenuItem state={state} send={send} />
					)}
					<Menu.Item
						onClick={() => {
							setOpen(true);
							request({
								type: "personality/read",
								requestId: crypto.randomUUID(),
							});
						}}
						className="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-highlighted:bg-menu-hover"
					>
						<FileUser size={16} aria-hidden="true" />
						性格設定
					</Menu.Item>
					<LogoutMenuItem state={state} send={send} />
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}

/** ログアウトの可否を判定するチャット状態と、要求の送信関数。 */
type LogoutMenuItemProps = {
	state: ChatState;
	send: (message: UiMessage) => void;
};

/** 実行状態に応じて認証管理への遷移を制限する。 */
function AuthManagementMenuItem({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}): ReactNode {
	return (
		<Menu.Item
			disabled={
				state.sessionPending ||
				state.run === "running" ||
				state.run === "cancelling"
			}
			onClick={() =>
				send({
					type: "auth/start",
					requestId: crypto.randomUUID(),
					methodId: "pi",
				})
			}
			className={cn(
				"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none",
				"data-highlighted:bg-menu-hover data-disabled:cursor-default data-disabled:opacity-50",
			)}
		>
			<KeyRound size={16} aria-hidden="true" />
			認証情報を管理
		</Menu.Item>
	);
}

/** 実行状態に従ってログアウト操作を提供する。 */
function LogoutMenuItem({ state, send }: LogoutMenuItemProps) {
	return (
		<Menu.Item
			disabled={logoutDisabled(state)}
			onClick={() =>
				send({
					type: "auth/logout",
					requestId: crypto.randomUUID(),
				})
			}
			className={cn(
				"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none",
				"data-highlighted:bg-menu-hover data-disabled:cursor-default data-disabled:opacity-50",
			)}
		>
			<LogOut size={16} aria-hidden="true" />
			ログアウト
		</Menu.Item>
	);
}

/** 性格設定ダイアログの表示・保存状態、エラーとフォーカスの復帰先。 */
type PersonalityDialogProps = {
	open: boolean;
	setOpen: Dispatch<SetStateAction<boolean>>;
	trigger: RefObject<HTMLButtonElement | null>;
	error: null | string;
	pending: boolean;
	state: ChatState;
	request: (message: PersonalityMessage) => void;
};

/** 保存範囲ごとの性格設定をダイアログで編集する。 */
function PersonalityDialog({
	open,
	setOpen,
	trigger,
	error,
	pending,
	state,
	request,
}: PersonalityDialogProps) {
	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30" />
				<Dialog.Popup
					finalFocus={trigger}
					className={cn(
						"fixed inset-y-[12px] right-[12px] z-50 flex w-[min(460px,calc(100vw-24px))] flex-col",
						"rounded-[8px] border border-solid border-menu-border bg-menu text-menu-text shadow-[0_6px_24px_#0003] outline-none",
					)}
				>
					<div className="flex items-center justify-between px-[16px] py-[12px]">
						<Dialog.Title className="m-0 text-[14px] font-medium">
							性格設定
						</Dialog.Title>
						<Dialog.Close
							aria-label="性格設定を閉じる"
							className="inline-flex size-[28px] items-center justify-center border-0 bg-transparent p-0 hover:bg-settings-hover"
						>
							<X size={16} />
						</Dialog.Close>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[16px]">
						<Dialog.Description className="mt-0 text-[11px] text-muted leading-[1.7]">
							グローバルとワークスペースの指示を、この順で結合します。変更は会話の開始・分岐・再開時に反映されます。
						</Dialog.Description>
						{error && (
							<p role="alert" className="text-[12px]">
								{error}
							</p>
						)}
						{pending && (
							<p role="status" className="text-[12px]">
								読み込み・保存中…
							</p>
						)}
						{state.personality &&
							(["global", "workspace"] as const).map((scope) => (
								<PersonalityPane
									key={scope}
									scope={scope}
									settings={state.personality![scope]}
									pending={pending}
									send={request}
								/>
							))}
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** 実行中と未接続時のログアウトを抑制する。 */
function logoutDisabled(state: ChatState): boolean | undefined {
	return (
		state.connection !== "ready" ||
		state.sessionPending ||
		state.run === "running" ||
		state.run === "cancelling"
	);
}

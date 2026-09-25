// 名前変更の入力と確定・取消を、履歴行の中に表示する。
import { useState } from "react";
import type { UiMessage } from "../../../shared/messages";

/** 空の名前は送信せず、Escape では入力だけを閉じる。 */
export function SessionRename({
	sessionId,
	title,
	disabled,
	send,
	close,
}: {
	sessionId: string;
	title: string;
	disabled: boolean;
	send: (message: UiMessage) => void;
	close: () => void;
}) {
	const [name, setName] = useState(title);
	return (
		<form
			className="flex flex-wrap gap-[6px] px-[12px] pb-[10px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (disabled || !name.trim()) {
					return;
				}
				send({
					type: "session/rename",
					sessionId,
					name: name.trim(),
					requestId: crypto.randomUUID(),
				});
				close();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					close();
				}
			}}
		>
			<input
				autoFocus
				aria-label="新しいセッション名"
				className="box-border min-w-0 w-full rounded-[4px] border border-solid border-input-border bg-input px-[8px] py-[6px] text-[12px] text-input-text focus-visible:outline-2 focus-visible:outline-focus"
				value={name}
				maxLength={200}
				disabled={disabled}
				onChange={(event) => setName(event.target.value)}
			/>
			<button
				type="submit"
				className="text-[12px]"
				disabled={disabled || !name.trim()}
			>
				保存
			</button>
			<button type="button" className="text-[12px]" onClick={close}>
				キャンセル
			</button>
		</form>
	);
}

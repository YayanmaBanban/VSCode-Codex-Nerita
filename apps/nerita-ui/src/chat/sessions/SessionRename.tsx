// 名前変更の入力と確定・取消を、履歴行の中に表示する。
import { useState, type KeyboardEvent } from "react";
import { useInitialFocus } from "../../hooks/useInitialFocus";
import { cn } from "cnfast";
import type { UiMessage } from "@nerita/shared/messages";

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
	const input = useInitialFocus<HTMLInputElement>();
	const handleKey = (event: KeyboardEvent<HTMLElement>) => {
		if (!event.nativeEvent.isComposing && event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	};
	return (
		<form
			className="flex flex-wrap gap-[6px] px-[12px] pb-[10px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (disabled || name.trim() === "") {
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
		>
			<input
				ref={input}
				onKeyDown={handleKey}
				aria-label="新しいセッション名"
				className={cn(
					"box-border w-full min-w-0 rounded-[4px] border border-solid",
					"border-input-border bg-input px-[8px] py-[6px]",
					"text-[12px] text-input-text",
					"focus-visible:outline-2 focus-visible:outline-focus",
				)}
				value={name}
				maxLength={200}
				disabled={disabled}
				onChange={(event) => setName(event.target.value)}
			/>
			<button
				type="submit"
				onKeyDown={handleKey}
				className="text-[12px]"
				disabled={disabled || name.trim() === ""}
			>
				保存
			</button>
			<button
				type="button"
				className="text-[12px]"
				onClick={close}
				onKeyDown={handleKey}
			>
				キャンセル
			</button>
		</form>
	);
}

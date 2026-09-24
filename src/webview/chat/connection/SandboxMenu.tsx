// オプションからサンドボックスの保存済み設定を選択する。
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight, Shield } from "lucide-react";
import type { WindowsSandboxImplementation } from "../../../shared/windowsSandbox";

/** ホバー待機とキーボード操作を同じサブメニューで扱う。 */
export function SandboxMenu({
	implementation,
	onSelect,
}: {
	implementation: WindowsSandboxImplementation | undefined;
	onSelect: (implementation: WindowsSandboxImplementation) => void;
}) {
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger
				openOnHover
				delay={300}
				className="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-highlighted:bg-menu-hover"
			>
				<Shield size={16} aria-hidden="true" />
				サンドボックス
				<ChevronRight
					size={14}
					className="ml-auto"
					aria-hidden="true"
				/>
			</Menu.SubmenuTrigger>
			<Menu.Portal>
				<Menu.Positioner
					side="left"
					align="start"
					sideOffset={4}
					collisionPadding={8}
					className="z-30"
				>
					<Menu.Popup className="min-w-[128px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px] text-menu-text shadow-[0_6px_24px_#0003]">
						<p className="m-0 max-w-[220px] px-[10px] py-[6px] text-[11px] text-muted">
							設定を保存して再接続し、新しい会話を開始します。Codexはconfig.tomlを優先します。
						</p>
						<Menu.RadioGroup
							value={implementation ?? ""}
							onValueChange={(value) =>
								onSelect(value as WindowsSandboxImplementation)
							}
						>
							{(
								[
									["elevated", "elevated（標準）"],
									[
										"unelevated",
										"unelevated（管理者権限なし）",
									],
								] as const
							).map(([value, label]) => (
								<Menu.RadioItem
									key={value}
									value={value}
									disabled={implementation === undefined}
									closeOnClick
									className="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none data-highlighted:bg-menu-hover data-disabled:cursor-default data-disabled:opacity-50"
								>
									<span className="size-[16px] shrink-0">
										<Menu.RadioItemIndicator>
											<Check
												size={16}
												className="text-[var(--vscode-testing-iconPassed,#4caf78)]"
												aria-hidden="true"
											/>
										</Menu.RadioItemIndicator>
									</span>
									{label}
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.SubmenuRoot>
	);
}

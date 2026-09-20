// VS Codeのユーザー設定とチャット専用コンテナの配置を同期する。
import * as vscode from "vscode";
import { isSidebarLocation, type SidebarLocation } from "../../shared/sidebar";

/** 不正な手編集値には既定のセカンダリを使用する。 */
export function sidebarLocation(): SidebarLocation {
	const value = vscode.workspace
		.getConfiguration("nerita.codex")
		.get("sidebarLocation");
	return isSidebarLocation(value) ? value : "secondary";
}

/** 空の専用コンテナを既定位置へ戻し、チャットだけを移動する。 */
export async function moveSidebar(location: SidebarLocation): Promise<void> {
	const destinationId =
		location === "primary"
			? "workbench.view.extension.nerita-primary"
			: "workbench.view.extension.nerita";
	// コンテナ自体をドラッグしていた場合も、選択したサイドバーへ戻す。
	await vscode.commands.executeCommand(
		`${destinationId}.resetViewContainerLocation`,
	);
	await vscode.commands.executeCommand("vscode.moveViews", {
		viewIds: ["nerita.codex.chat"],
		destinationId,
	});
	await vscode.commands.executeCommand("nerita.codex.chat.focus");
}

/** ワークスペースに依存しない配置をsettings.jsonへ保存する。 */
export async function saveSidebar(location: SidebarLocation): Promise<void> {
	await vscode.workspace
		.getConfiguration("nerita.codex")
		.update("sidebarLocation", location, vscode.ConfigurationTarget.Global);
}

/** 設定変更と初回復元を直列化し、移動中の再生成による重複を防ぐ。 */
export class SidebarPlacement implements vscode.Disposable {
	private task = Promise.resolve();
	private applied: SidebarLocation | undefined;
	private disposed = false;
	private configuration: vscode.Disposable;
	/** 移動成功後に全Webviewへ保存値を通知する。 */
	constructor(private notify: (location: SidebarLocation) => void) {
		this.configuration = vscode.workspace.onDidChangeConfiguration(
			(event) => {
				if (event.affectsConfiguration("nerita.sidebarLocation")) {
					void this.sync().catch(() => {
						void vscode.window.showErrorMessage(
							"サイドバーの配置を変更できませんでした。",
						);
					});
				}
			},
		);
	}
	/** 初回表示で配置の復元が必要か判定する。 */
	get initialized(): boolean {
		return this.applied !== undefined;
	}
	/** 前の移動が失敗しても、次の要求で再試行できるようにする。 */
	sync(): Promise<void> {
		const task = this.task.then(async () => {
			if (this.disposed) {
				return;
			}
			const location = sidebarLocation();
			if (this.applied !== location) {
				await moveSidebar(location);
				this.applied = location;
			}
			if (!this.disposed) {
				this.notify(location);
			}
		});
		this.task = task.catch(() => {});
		return task;
	}
	/** 設定の購読と未開始の移動を停止する。 */
	dispose(): void {
		this.disposed = true;
		this.configuration.dispose();
	}
}

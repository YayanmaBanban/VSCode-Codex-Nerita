// Webview の描画入口。検証済みの通信アダプターを各 Svelte 画面へ注入する。
import { mount } from "svelte";
import {
	createVsCodeBridge,
	createPiAuthPost,
	createGuardrailsBridge,
	createWorkflowBridge,
	createAgentManagerBridge,
	createTrustBridge,
	createSandboxBridge,
	createCredentialBridge,
	createDlcWorkspaceBridge,
	requestHostPresentation,
} from "./bridge/vscodeBridge";
import "./chat/tailwind.css";
import { hostPresentationKey } from "./ui/hostPresentation";
import type { HostPresentation } from "@nerita/shared/hostPresentation";

/** 既存の data-page と同じ画面を、既存の Bridge に接続する。 */
async function mountPage(target: HTMLElement) {
	const context = new Map([
		[hostPresentationKey, await requestHostPresentation()],
	]);
	const settingsPages = [
		"credentials",
		"sandbox",
		"workspace-trust",
		"agent-manager",
		"pi-workflow",
		"pi-guardrails",
	];
	if (settingsPages.includes(target.dataset.page ?? "")) {
		await mountSettingsPage(target, context);
		return;
	}
	switch (target.dataset.page ?? "chat") {
		case "dlc-workspace": {
			const { default: DlcWorkspace } =
				await import("./chat/dlc/DlcWorkspace.svelte");
			mount(DlcWorkspace, {
				target,
				context,
				props: { bridge: createDlcWorkspaceBridge() },
			});
			break;
		}
		case "pi-auth": {
			const { default: PiAuthPage } =
				await import("./pi/PiAuthPage.svelte");
			mount(PiAuthPage, {
				target,
				context,
				props: { post: createPiAuthPost() },
			});
			break;
		}
		default: {
			const { default: ChatApp } = await import("./chat/ChatApp.svelte");
			mount(ChatApp, {
				target,
				context,
				props: { bridge: createVsCodeBridge() },
			});
		}
	}
}

/** 設定画面にも同じ Host の表示情報を渡し、個別の Bridge と購読の寿命は各画面に任せる。 */
async function mountSettingsPage(
	target: HTMLElement,
	context: Map<symbol, HostPresentation>,
) {
	switch (target.dataset.page ?? "") {
		case "credentials": {
			const { default: CredentialSettings } =
				await import("./pi/CredentialSettings.svelte");
			mount(CredentialSettings, {
				target,
				context,
				props: { bridge: createCredentialBridge() },
			});
			break;
		}
		case "sandbox": {
			const { default: SandboxSettings } =
				await import("./pi/SandboxSettings.svelte");
			mount(SandboxSettings, {
				target,
				context,
				props: { bridge: createSandboxBridge() },
			});
			break;
		}
		case "workspace-trust": {
			const { default: TrustManager } =
				await import("./trust/TrustManager.svelte");
			mount(TrustManager, {
				target,
				context,
				props: { bridge: createTrustBridge() },
			});
			break;
		}
		case "agent-manager": {
			const { default: AgentManager } =
				await import("./agentManager/AgentManager.svelte");
			mount(AgentManager, {
				target,
				context,
				props: { bridge: createAgentManagerBridge() },
			});
			break;
		}
		case "pi-workflow": {
			const { default: WorkflowEditor } =
				await import("./pi/workflows/WorkflowEditor.svelte");
			mount(WorkflowEditor, {
				target,
				context,
				props: { bridge: createWorkflowBridge() },
			});
			break;
		}
		case "pi-guardrails": {
			const { default: GuardrailsEditor } =
				await import("./pi/guardrails/GuardrailsEditor.svelte");
			mount(GuardrailsEditor, {
				target,
				context,
				props: { bridge: createGuardrailsBridge() },
			});
			break;
		}
	}
}

const target = document.getElementById("root");
if (target) {
	void mountPage(target).catch(() => {
		target.setAttribute("role", "alert");
		target.textContent =
			"画面を初期化できませんでした。画面を開き直してください。";
	});
}

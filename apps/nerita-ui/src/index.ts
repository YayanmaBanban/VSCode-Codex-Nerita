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
} from "./bridge/vscodeBridge";
import "./chat/tailwind.css";

/** 既存の data-page と同じ画面を、既存の Bridge に接続する。 */
async function mountPage(target: HTMLElement) {
	switch (target.dataset.page ?? "chat") {
		case "dlc-workspace": {
			const { default: DlcWorkspace } =
				await import("./chat/dlc/DlcWorkspace.svelte");
			mount(DlcWorkspace, {
				target,
				props: { bridge: createDlcWorkspaceBridge() },
			});
			break;
		}
		case "credentials": {
			const { default: CredentialSettings } =
				await import("./pi/CredentialSettings.svelte");
			mount(CredentialSettings, {
				target,
				props: { bridge: createCredentialBridge() },
			});
			break;
		}
		case "sandbox": {
			const { default: SandboxSettings } =
				await import("./pi/SandboxSettings.svelte");
			mount(SandboxSettings, {
				target,
				props: { bridge: createSandboxBridge() },
			});
			break;
		}
		case "workspace-trust": {
			const { default: TrustManager } =
				await import("./trust/TrustManager.svelte");
			mount(TrustManager, {
				target,
				props: { bridge: createTrustBridge() },
			});
			break;
		}
		case "agent-manager": {
			const { default: AgentManager } =
				await import("./agentManager/AgentManager.svelte");
			mount(AgentManager, {
				target,
				props: { bridge: createAgentManagerBridge() },
			});
			break;
		}
		case "pi-workflow": {
			const { default: WorkflowEditor } =
				await import("./pi/workflows/WorkflowEditor.svelte");
			mount(WorkflowEditor, {
				target,
				props: { bridge: createWorkflowBridge() },
			});
			break;
		}
		case "pi-guardrails": {
			const { default: GuardrailsEditor } =
				await import("./pi/guardrails/GuardrailsEditor.svelte");
			mount(GuardrailsEditor, {
				target,
				props: { bridge: createGuardrailsBridge() },
			});
			break;
		}
		case "pi-auth": {
			const { default: PiAuthPage } =
				await import("./pi/PiAuthPage.svelte");
			mount(PiAuthPage, { target, props: { post: createPiAuthPost() } });
			break;
		}
		default: {
			const { default: ChatApp } = await import("./chat/ChatApp.svelte");
			mount(ChatApp, { target, props: { bridge: createVsCodeBridge() } });
		}
	}
}

const target = document.getElementById("root");
if (target) {
	void mountPage(target);
}

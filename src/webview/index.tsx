// Webview の唯一の描画入口。Bridge を作成して React へ注入する。
import { createRoot } from "react-dom/client";
import {
	createVsCodeBridge,
	createPiAuthPost,
	createGuardrailsBridge,
	createWorkflowBridge,
	createAgentManagerBridge,
	createTrustBridge,
} from "./vscodeBridge";
import { ChatApp } from "./chat/ChatApp";
import { PiAuthPage } from "./pi/PiAuthPage";
import { GuardrailsEditor } from "./pi/guardrails/GuardrailsEditor";
import { WorkflowEditor } from "./pi/workflows/WorkflowEditor";
import { AgentManager } from "./agentManager/AgentManager";
import { TrustManager } from "./trust/TrustManager";
import "./chat/tailwind.css";
const root = document.getElementById("root");
if (root) {
	if (root.dataset.page === "workspace-trust") {
		createRoot(root).render(<TrustManager bridge={createTrustBridge()} />);
	} else if (root.dataset.page === "agent-manager") {
		createRoot(root).render(
			<AgentManager bridge={createAgentManagerBridge()} />,
		);
	} else if (root.dataset.page === "pi-workflow") {
		createRoot(root).render(
			<WorkflowEditor bridge={createWorkflowBridge()} />,
		);
	} else if (root.dataset.page === "pi-guardrails") {
		createRoot(root).render(
			<GuardrailsEditor bridge={createGuardrailsBridge()} />,
		);
	} else if (root.dataset.page === "pi-auth") {
		createRoot(root).render(<PiAuthPage post={createPiAuthPost()} />);
	} else {
		createRoot(root).render(<ChatApp bridge={createVsCodeBridge()} />);
	}
}

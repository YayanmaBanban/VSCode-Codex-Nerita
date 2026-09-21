// Webview の唯一の描画入口。Bridge を作成して React へ注入する。
import { createRoot } from "react-dom/client";
import { createVsCodeBridge, createPiAuthPost } from "./vscodeBridge";
import { ChatApp } from "./chat/ChatApp";
import { PiAuthPage } from "./pi-auth/PiAuthPage";
import "./chat/tailwind.css";
const root = document.getElementById("root");
if (root) {
	if (root.dataset.page === "pi-auth") {
		createRoot(root).render(<PiAuthPage post={createPiAuthPost()} />);
	} else {
		createRoot(root).render(<ChatApp bridge={createVsCodeBridge()} />);
	}
}

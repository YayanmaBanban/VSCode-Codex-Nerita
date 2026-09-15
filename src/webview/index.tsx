// Webview の唯一の描画入口。Bridge を作成して React へ注入する。
import { createRoot } from "react-dom/client";
import { createVsCodeBridge } from "./vscodeBridge";
import { ChatApp } from "./chat/ChatApp";
import "./chat/tailwind.css";
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ChatApp bridge={createVsCodeBridge()} />);
}

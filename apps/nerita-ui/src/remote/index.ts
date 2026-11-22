// VS Code API を使わず、ブラウザーにモバイル画面をマウントする。
import { mount } from "svelte";
import "../chat/tailwind.css";
import RemoteApp from "./RemoteApp.svelte";

// 通常のブラウザーにモバイル画面をマウントする。
const target = document.getElementById("app");
if (target) {
	mount(RemoteApp, { target });
}

// 実際のチャット画面でセッション一覧の各状態を観察する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import {
	createSessionBridge,
	type SessionScenario,
} from "./mocks/mockSessionBridge";

/** マウントごとに独立した履歴と通信を渡す。 */
function SessionsStory({ scenario }: { scenario: SessionScenario }) {
	const bridge = useMemo(() => createSessionBridge(scenario), [scenario]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/Sessions",
	component: SessionsStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "history" },
} satisfies Meta<typeof SessionsStory>;
export default meta;
/** 履歴ペインの Story 定義。 */
type Story = StoryObj<typeof meta>;
export const History: Story = {};
export const Paginated: Story = { args: { scenario: "paginated" } };
export const Empty: Story = { args: { scenario: "empty" } };
export const Error: Story = { args: { scenario: "error" } };
export const Unsupported: Story = { args: { scenario: "unsupported" } };

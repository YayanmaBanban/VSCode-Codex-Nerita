<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import Messages from "../../../src/chat/messages/Messages.svelte";
	import "../../../src/chat/chat.css";
	const path = {
		kind: "file" as const,
		name: "とても長いファイル名を持つ日本語のメッセージコンポーネント.tsx",
		path: "D:/workspace/long.tsx",
		uri: "file:///D:/workspace/long.tsx",
	};
	const text = `**確認対象** ${path.path}\nコード内: \`${path.path}\``;
	const references = [
		text.indexOf(path.path),
		text.lastIndexOf(path.path),
	].map((offset) => ({ offset, path }));
</script>

<main class="p-[14px]">
	<Messages
		busy={false}
		send={() => {}}
		messages={[
			{ id: "user", role: "user", text, references },
			{ id: "answer", role: "assistant", text, references },
		]}
	></Messages>
</main>

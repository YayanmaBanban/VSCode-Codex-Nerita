<!-- Lexical のリンクとコード削除ボタンを監視し、編集 DOM を置換せず共通ツールチップを接続する。 -->
<script lang="ts">
	import { getAllContexts, mount, onMount, unmount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import { getLexicalEditor } from "./lexicalContext";

	const editor = getLexicalEditor();
	const context = getAllContexts();
	let container: HTMLDivElement | undefined;

	/** エディターの寿命に合わせて DOM の監視と表示部品をまとめて解放する。 */
	function connectTooltips(target: HTMLDivElement) {
		const tooltips = new SvelteMap<HTMLElement, ReturnType<typeof mount>>();
		let root: HTMLElement | null = null;
		let disposed = false;
		/** 本文更新で追加・削除された対象だけに表示部品を取り付け・解放する。 */
		function refresh() {
			if (disposed) {
				return;
			}
			for (const [element, instance] of tooltips) {
				if (root?.contains(element) !== true) {
					void unmount(instance);
					tooltips.delete(element);
				}
			}
			for (const element of root?.querySelectorAll<HTMLElement>(
				"a[href], [data-composer-block-delete]",
			) ?? []) {
				if (tooltips.has(element)) {
					continue;
				}
				const content = element.matches("a[href]")
					? "Ctrl＋クリックでリンクを開く"
					: "コードブロックを削除";
				tooltips.set(
					element,
					mount(SettingsTooltip, {
						target,
						context,
						props: { externalTrigger: element, content },
					}),
				);
			}
		}
		const observer = new MutationObserver(refresh);
		const unregister = editor.registerRootListener((element) => {
			observer.disconnect();
			root = element;
			if (root) {
				observer.observe(root, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["href"],
				});
			}
			refresh();
		});
		return () => {
			disposed = true;
			observer.disconnect();
			unregister();
			for (const instance of tooltips.values()) {
				void unmount(instance);
			}
			tooltips.clear();
		};
	}
	onMount(() => (container ? connectTooltips(container) : undefined));
</script>

<div bind:this={container} class="contents"></div>

<!-- Svelte が生成しない DOM に、共通ツールチップの属性・イベント・参照 attachment を取り付ける。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import type { Attachment } from "svelte/attachments";

	let {
		element,
		props,
	}: { element: HTMLElement; props: Record<string, unknown> } = $props();
	const originalAttributes = new SvelteMap<
		HTMLElement,
		SvelteMap<string, string | null>
	>();

	/** 元の操作・フォーカス順を保ち、ツールチップの表示属性だけを更新する。 */
	function applyAttributes(
		node: HTMLElement,
		attributes: Record<string, unknown>,
	) {
		let original = originalAttributes.get(node);
		if (!original) {
			original = new SvelteMap();
			originalAttributes.set(node, original);
		}
		for (const [key, value] of Object.entries(attributes)) {
			const ignored =
				key.startsWith("on") ||
				["type", "disabled", "tabindex"].includes(key);
			if (ignored) {
				continue;
			}
			const text = attributeText(value);
			if (text === undefined) {
				continue;
			}
			if (!original.has(key)) {
				original.set(key, node.getAttribute(key));
			}
			if (text === null) {
				node.removeAttribute(key);
			} else {
				node.setAttribute(key, text);
			}
		}
	}
	/** DOM を置換せず、Bits UI が生成した安定したハンドラーと参照を登録する。 */
	function connect(node: HTMLElement, attributes: Record<string, unknown>) {
		const cleanup: (() => void)[] = [];
		applyAttributes(node, attributes);
		for (const key of Reflect.ownKeys(attributes)) {
			const value: unknown = Reflect.get(attributes, key);
			if (typeof key === "symbol" && isAttachment(value)) {
				const detach = value(node);
				if (detach) {
					cleanup.push(detach);
				}
			} else if (typeof key === "string" && key.startsWith("on")) {
				if (!isEventListener(value)) {
					continue;
				}
				const event = key.slice(2);
				const listener = value;
				node.addEventListener(event, listener);
				cleanup.push(() => node.removeEventListener(event, listener));
			}
		}
		return () => {
			for (const dispose of cleanup.slice().reverse()) {
				dispose();
			}
			for (const [key, value] of originalAttributes.get(node) ?? []) {
				if (value === null) {
					node.removeAttribute(key);
				} else {
					node.setAttribute(key, value);
				}
			}
			originalAttributes.delete(node);
		};
	}
	/** DOM 属性に使える値だけを文字列にし、未指定値は属性の削除として扱う。 */
	function attributeText(value: unknown): string | null | undefined {
		if (value === undefined || value === null || value === false) {
			return null;
		}
		if (value === true) {
			return "";
		}
		if (typeof value === "string" || typeof value === "number") {
			return String(value);
		}
		return undefined;
	}
	/** Bits UI のシンボル属性から、Svelte の参照 attachment を取り出す。 */
	function isAttachment(value: unknown): value is Attachment<HTMLElement> {
		return typeof value === "function";
	}
	/** Bits UI のイベント属性だけを既存 DOM の listener に接続する。 */
	function isEventListener(value: unknown): value is EventListener {
		return typeof value === "function";
	}
	// 既存 DOM が変わった場合だけ接続し直し、open に伴う属性更新では参照を破棄しない。
	$effect(() => {
		const node = element;
		return untrack(() => connect(node, props));
	});
	// aria-describedby と表示状態は Bits UI の最新属性へ同期する。
	$effect(() => {
		const node = element;
		const attributes = props;
		untrack(() => applyAttributes(node, attributes));
	});
</script>

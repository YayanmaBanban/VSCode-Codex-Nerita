<!-- 入力欄の URL をリンク化し、クリック時の既定動作を抑えて Host へリンクを開く要求を送る。 -->
<script lang="ts">
	import { onMount } from "svelte";
	import { type ElementNode, mergeRegister } from "lexical";
	import {
		autoLinkUrlMatcher,
		registerAutoLink,
		type LinkMatcher,
	} from "@lexical/link";
	import { PastedBlockNode } from "./PastedBlockNode";
	import { getLexicalEditor } from "./lexicalContext";
	/** URL の認識は Lexical へ任せ、開き方をリンクのツールチップに示す。 */
	const matchUrl: LinkMatcher = (text) => {
		const match = autoLinkUrlMatcher(text);
		return match
			? {
					...match,
					attributes: {
						target: "_blank",
						rel: "noopener noreferrer",
					},
				}
			: null;
	};
	const matchers = [matchUrl];
	const excludeParents = [
		(parent: ElementNode) => parent instanceof PastedBlockNode,
	];

	/** 通常クリックは編集に使い、修飾クリックだけを開く操作にする。 */
	function openLink(event: MouseEvent) {
		const link =
			event.target instanceof Element
				? event.target.closest<HTMLAnchorElement>("a[href]")
				: null;
		if (!link || !/^https?:\/\//i.test(link.href)) {
			return;
		}
		// VS Code は `defaultPrevented` に関係なく `window` まで届いたリンククリックを開く。
		// 編集時は伝播も止め、修飾クリックは信頼済みのイベントのまま Host へ渡す。
		event.preventDefault();
		if (!event.ctrlKey && !event.metaKey) {
			event.stopPropagation();
		}
	}

	const editor = getLexicalEditor();
	onMount(() =>
		mergeRegister(
			registerAutoLink(editor, {
				matchers,
				excludeParents,
				changeHandlers: [],
			}),
			editor.registerRootListener((root, previous) => {
				previous?.removeEventListener("click", openLink, true);
				root?.addEventListener("click", openLink, true);
			}),
			() =>
				editor
					.getRootElement()
					?.removeEventListener("click", openLink, true),
		),
	);
</script>

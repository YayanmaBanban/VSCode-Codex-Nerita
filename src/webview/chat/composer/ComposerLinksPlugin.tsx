// 通常文の URL をリンクにし、文字の編集とリンクを開く操作を分ける。
import { useEffect } from "react";
import { type ElementNode } from "lexical";
import { autoLinkUrlMatcher, type LinkMatcher } from "@lexical/link";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PastedBlockNode } from "./PastedBlockNode";

/** URL の認識は Lexical へ任せ、開き方をリンクのツールチップに示す。 */
const matchUrl: LinkMatcher = (text) => {
	const match = autoLinkUrlMatcher(text);
	return match
		? {
				...match,
				attributes: {
					target: "_blank",
					rel: "noopener noreferrer",
					title: "Ctrl＋クリックでリンクを開く",
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

/** 自動リンクと DOM イベントを接続し、エディタの解除時に後始末する。 */
export function ComposerLinksPlugin() {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerRootListener((root) => {
				if (!root) {
					return;
				}
				root.addEventListener("click", openLink, true);
				return () => {
					root.removeEventListener("click", openLink, true);
				};
			}),
		[editor],
	);
	return (
		<AutoLinkPlugin matchers={matchers} excludeParents={excludeParents} />
	);
}

// コードフェンスだけを構造化し、HTML は常に React のテキストとして表示する。
/** 未検証 HTML を挿入せず、通常文とコードを読みやすく分ける。 */
export function MessageText({ text }: { text: string }) {
	const blocks = text.split(/```[^\n]*\n([\s\S]*?)(?:```|$)/g);
	return (
		<>
			{blocks.map((block, index) =>
				index % 2 === 1 ? (
					<pre key={index}>
						<code>{block}</code>
					</pre>
				) : (
					<span key={index}>{block}</span>
				),
			)}
		</>
	);
}

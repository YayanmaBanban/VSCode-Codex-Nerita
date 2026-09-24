// 依存コードと子プロセスを隔離できるまで、外部拡張のHostロードを拒否する。

/** パスの許可だけではコードの完全性と権限上限を保証できない。 */
export function resolveTrustedPiExtensions(
	paths: readonly string[],
): Promise<string[]> {
	if (paths.length) {
		return Promise.reject(
			new Error(
				"外部Pi拡張は依存コードとsubagentの権限を隔離できないためロードできません。trustedExtensionPathsを空にしてください。",
			),
		);
	}
	return Promise.resolve([]);
}

// Shellへ必要なOS変数だけを渡し、RPCの上書き仕様に合わせて不要な継承値を除去する。
const allowed =
	/^(?:systemroot|windir|systemdrive|comspec|path|pathext|temp|tmp|programfiles|programfiles\(x86\)|programw6432|programdata|userprofile|homedrive|homepath|localappdata|appdata|os|processor_architecture|number_of_processors)$/i;

/** provider token等の値をログや承認画面へ渡さない。 */
export function commandEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string | null> {
	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [
			key,
			allowed.test(key) ? (value ?? null) : null,
		]),
	);
}

/** 専用App Server自体にも認証用環境を継承させず、設定の所在だけ維持する。 */
export function sandboxServerEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(commandEnvironment())) {
		if (value !== null) {
			env[key] = value;
		}
	}
	if (process.env.CODEX_HOME) {
		env.CODEX_HOME = process.env.CODEX_HOME;
	}
	return env;
}

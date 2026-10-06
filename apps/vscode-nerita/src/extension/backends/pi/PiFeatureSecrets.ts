// Host の環境にある認証値も出力保護の対象にする。保存済み認証は専用ストア側で保護する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
/** 平文の Pi 認証ファイルを通常の実行経路では読み込まない。 */
export function piFeatureSecrets(): Promise<readonly string[]> {
	return Promise.resolve(
		Object.entries(process.env)
			.filter(
				([key, value]) =>
					/TOKEN|SECRET|PASSWORD|API_KEY/.test(key) &&
					!!isNonEmptyString(value),
			)
			.map(([, value]) => value!),
	);
}

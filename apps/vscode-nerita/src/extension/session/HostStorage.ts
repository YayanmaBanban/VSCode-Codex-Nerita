// ウィンドウやプロファイルをまたぐ実行状態を、同じ Windows ユーザーの管理領域に置く。
import { join } from "node:path";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

export function hostStorageRoot(): string {
	const local = process.env.LOCALAPPDATA;
	if (!isNonEmptyString(local)) {
		throw new Error("Nerita の実行状態の保存先を取得できません。");
	}
	return join(local, "Nerita", "runtime");
}

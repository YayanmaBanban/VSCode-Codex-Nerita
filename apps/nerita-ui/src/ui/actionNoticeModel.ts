// 通知とエラー表示で共有する外観と操作の契約。
/** 認証や信頼の判断は利用側が担当し、実行する操作を渡す。 */
export type NoticeAction = {
	id: string;
	name: string;
	onClick: () => void;
	/** カーテンの背景色クラス。未指定時は既定の水色を使う。 */
	curtainClassName?: string;
};
/** 通知とエラー表示に共通する枠・色・余白。 */
export const noticeClass =
	"mx-[14px] mt-[12px] mb-0 rounded-[8px] border border-solid border-alert-border bg-alert p-[12px] leading-[1.7]";

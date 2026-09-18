// 送信・停止・発言操作で共有するボタンと、移動先のフォーカス表示を定義する。

/** 色は操作ごとに指定し、アイコンの寸法と配置を共通化する。 */
export const iconButtonClass =
	"icon-button inline-grid size-[32px] shrink-0 place-items-center border-transparent p-0 text-white";

/** 発言の補助操作は送信ボタンより小さく表示する。 */
export const messageIconButtonClass =
	"icon-button inline-grid size-[24px] shrink-0 place-items-center border-transparent p-0 text-white";

/** 移動先へのフォーカスは保ち、本文や操作領域全体の枠だけを隠す。 */
export const messageFocusClass = "focus:outline-none";

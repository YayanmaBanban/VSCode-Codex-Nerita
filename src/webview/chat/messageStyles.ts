// 送信・停止・発言操作で共有するボタンと、移動先のフォーカス表示を定義する。

/** 色は操作ごとに指定し、アイコンの寸法と配置を共通化する。 */
export const iconButtonClass =
	"icon-button inline-grid size-[32px] shrink-0 place-items-center border-transparent p-0 text-white";

/** キーボード操作とプログラムによる移動先を同じ枠で示す。 */
export const messageFocusClass =
	"focus:outline-2 focus:outline-solid focus:outline-focus focus:outline-offset-[3px]";

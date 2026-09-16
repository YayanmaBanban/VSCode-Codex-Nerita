// ブラウザの幅を監視し、モバイル表示の判定を共有する。

import * as React from "react";

const MOBILE_BREAKPOINT = 1024;

/** ウィンドウのリサイズに追従してモバイル幅かどうかを返す。 */
export function useIsMobile() {
	const [isMobile, setIsMobile] = React.useState<boolean>(
		typeof window !== "undefined"
			? window.innerWidth < MOBILE_BREAKPOINT
			: false,
	);

	React.useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const checkMobile = () => {
			setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
		};

		window.addEventListener("resize", checkMobile);
		checkMobile(); // Initial check

		return () => window.removeEventListener("resize", checkMobile);
	}, []);

	return isMobile;
}

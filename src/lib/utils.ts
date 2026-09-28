// 数値・日付・文字列の整形、ID の生成、関数の実行頻度制御を提供する。

// Utility function to format a number with currency
export function formatCurrency(
	amount: number,
	currency = "USD",
	options?: Omit<Intl.NumberFormatOptions, "style" | "currency">,
) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		...options,
	}).format(amount);
}

// Utility function to generate a unique ID
export function generateUniqueId(prefix = "id") {
	return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

// Utility function to truncate text
export function truncateText(text: string, maxLength: number) {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.substring(0, maxLength)}...`;
}

// Utility function to format date
export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions) {
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
		...options,
	}).format(date);
}

// Utility function to debounce function calls
export function debounce<Args extends unknown[]>(
	func: (...args: Args) => void,
	wait: number,
) {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	return function (...args: Args) {
		const later = () => {
			timeout = null;
			func(...args);
		};
		if (timeout !== null) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(later, wait);
	};
}

// Utility function to throttle function calls
export function throttle<Args extends unknown[]>(
	func: (...args: Args) => void,
	limit: number,
) {
	let inThrottle = false;
	return function (...args: Args) {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => {
				inThrottle = false;
			}, limit);
		}
	};
}

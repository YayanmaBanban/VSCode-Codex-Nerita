// ホバーとキーボードフォーカスでボタンを覆うカーテンを共有する。
import { cn } from "cnfast";

/** 親ボタンに `group`・`relative`・`overflow-hidden` を指定し、色は利用側で渡す。 */
export function ButtonCurtain({
	name,
	className,
}: {
	name: string;
	className: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-0 flex items-center justify-center",
				"text-black [clip-path:polygon(0_0,0_0,0_0)]",
				"transition-[clip-path] duration-300 ease-out motion-reduce:transition-none",
				"group-hover:[clip-path:polygon(0_0,200%_0,0_200%)]",
				"group-focus-visible:[clip-path:polygon(0_0,200%_0,0_200%)]",
				className,
			)}
		>
			{name}
		</span>
	);
}

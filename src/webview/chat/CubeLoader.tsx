// 応答中の状態を小さな立体の反転で控えめに伝える。
import "./loaders.css";

/** 読み上げ用の状態名を残し、表示には立方体だけを使う。 */
export function CubeLoader() {
	return (
		<span className="cube-loader" role="status" aria-label="応答中">
			<span className="cube-loader-shape" aria-hidden="true">
				{["front", "back", "left", "right", "top", "bottom"].map(
					(face) => (
						<span key={face} className={`cube-face cube-${face}`} />
					),
				)}
			</span>
		</span>
	);
}

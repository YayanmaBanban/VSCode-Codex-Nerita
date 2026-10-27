<!-- 実行状態の猫を静的 SVG として描画し、動きは同梱 CSS に任せる。 -->
<script lang="ts">
	import "./thinkingIndicator.css";
	import "./catLoaf.css";
	import "./catStartled.css";

	let { kind }: { kind: "writing" | "loaf" | "startled" } = $props();
</script>

<span
	class="run-status-icon block size-12 shrink-0 [&>svg]:size-full"
	aria-hidden="true"
>
	{#if kind === "writing"}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="48"
			height="48"
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			role="img"
			aria-label="白いメガネをかけ、机でペンを動かして書きものをする猫"
			class="cat-writing-glasses-48"
		>
			<!-- 1行を書く周期と細かな筆運びは、CSS カスタムプロパティで調整可能。 -->

			<!-- 香箱座り版と同じ顔。位置だけ変え、メガネも頭と一緒に動かす。 -->
			<g class="cwg48-head">
				<g transform="translate(8 -9)">
					<!-- 三角の耳と、丸い頬。 -->
					<path
						d="M5.5 23V12q0-1.5 1.2-.6L12 16q4-1.5 7.5 0l5.3-4.6q1.2-.9 1.2.6v11c0 6.4-3.7 10-10.2 10S5.5 29.4 5.5 23Z"
					/>
					<!-- レンズだけ白固定。頭と体には背景色を塗らない。 -->
					<g fill="#fff" stroke-width="1.8">
						<rect x="6.5" y="20" width="8" height="5.8" rx="1.8" />
						<rect x="17.5" y="20" width="8" height="5.8" rx="1.8" />
					</g>
					<path d="M14.5 22h3" stroke-width="1.8" />
					<path d="m14.2 28.7 1.5 1.2 1.5-1.2" stroke-width="1.5" />
					<path d="M3 27h3m19 0h3" stroke-width="1.5" />
				</g>
			</g>

			<!-- 机に添えた前足。肩やお腹の補助線を省いて重なりを避ける。 -->
			<path
				d="M32 21.5l2 4.5c2.5 1 4.5 3 4.5 5 0 1.3-1.2 2-3 2h-4.8c-1.5 0-2.3-1-1.8-2.2.4-1.3 1.8-2.1 3.6-2.1"
			/>

			<!-- 紙は下辺だけ、筆跡は短い1本の線で示す。 -->
			<path d="M17 36h12" stroke-width="1.6" />
			<path
				class="cwg48-ink"
				d="M18 33h4"
				pathLength="1"
				stroke-width="1.5"
			/>

			<!-- ペンと握る前足をまとめて動かす。左から右に書き、持ち上げて戻す。 -->
			<g class="cwg48-travel">
				<g class="cwg48-stroke">
					<path d="m8 22.4 3 2.9m5.5 6.1L18 33" />
					<path
						d="M12 26c-4-1-6 4-2 6s8 0 7-3c-.5-1.5-2.5-2.5-5-3Z"
					/>
				</g>
			</g>

			<!-- ペンギン版と同じ机。天板1本と脚2本だけに省略する。 -->
			<path d="M4 40h40M8 40v5m32-5v5" />
		</svg>
	{:else if kind === "loaf"}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="48"
			height="48"
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			role="img"
			aria-label="白いメガネで香箱座りし、尻尾をゆっくり上下させる猫"
			class="cat-loaf-glasses-48"
		>
			<!-- 尻尾だけを動かす。付け根は固定し、床に触れた姿勢で少し休む。 -->
			<g class="clg48-tail">
				<path d="M35.5 34C39 34.5 42 37.3 45 37.3" stroke-width="2.4" />
			</g>

			<!-- 胴体は低く丸い香箱形。脚を外に出さない。 -->
			<path d="M26 22c6-1 10 4 10 10v1.5c0 3-2 4-5 4H14c-4 0-6-2-6-5" />
			<path d="M27 31q-3 1-3 4" />

			<!-- 三角の耳と、丸い頬。 -->
			<path
				d="M5.5 23V12q0-1.5 1.2-.6L12 16q4-1.5 7.5 0l5.3-4.6q1.2-.9 1.2.6v11c0 6.4-3.7 10-10.2 10S5.5 29.4 5.5 23Z"
			/>

			<!-- メガネのレンズだけ白く塗る。背景と猫の胴体は透過。 -->
			<g fill="#fff" stroke-width="1.8">
				<rect x="6.5" y="20" width="8" height="5.8" rx="1.8" />
				<rect x="17.5" y="20" width="8" height="5.8" rx="1.8" />
			</g>
			<path d="M14.5 22h3" stroke-width="1.8" />

			<!-- 口元は小さな1本に省略。 -->
			<path d="m14.2 28.7 1.5 1.2 1.5-1.2" stroke-width="1.5" />
			<path d="M3 27h3m19 0h3" stroke-width="1.5" />
		</svg>
	{:else}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="48"
			height="48"
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			role="img"
			aria-label="書いている途中で正面を向いて驚き、ペンを落とす白いメガネの猫"
			class="cat-startled-fixed-48"
		>
			<!-- 48px 用の元パスを維持。全パーツを1本の5.6秒タイムラインに同期。 -->

			<defs>
				<!-- 前足の後ろにあるペンだけを抜く。白い背景の塗りつぶしではない。 -->
				<mask
					id="csf48-v2-paw-mask"
					maskUnits="userSpaceOnUse"
					maskContentUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="48"
					height="48"
					style="mask-type:luminance"
				>
					<rect width="48" height="48" fill="white" stroke="none" />
					<g class="csf48-motion csf48-travel">
						<g class="csf48-motion csf48-wrist">
							<g class="csf48-motion csf48-recoil">
								<path
									d="M12 26c-4-1-6 4-2 6s8 0 7-3c-.5-1.5-2.5-2.5-5-3Z"
									fill="black"
									stroke="black"
									stroke-width="3.6"
								/>
							</g>
						</g>
					</g>
				</mask>
				<!-- 落ちるペンと紙の線が交差しても、背面の紙が透けない。 -->
				<mask
					id="csf48-v2-paper-mask"
					maskUnits="userSpaceOnUse"
					maskContentUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="48"
					height="48"
					style="mask-type:luminance"
				>
					<rect width="48" height="48" fill="white" stroke="none" />
					<g class="csf48-motion csf48-drop-visible">
						<path
							class="csf48-motion csf48-drop"
							d="M12 22.4 22 33"
							fill="none"
							stroke="black"
							stroke-width="4"
						/>
					</g>
				</mask>
			</defs>

			<!-- 頭は1つだけ。輪郭は変形せず、傾きと顔の向きで前を見る。 -->
			<g class="csf48-motion csf48-head">
				<g transform="translate(8 -9)">
					<path
						d="M5.5 23V12q0-1.5 1.2-.6L12 16q4-1.5 7.5 0l5.3-4.6q1.2-.9 1.2.6v11c0 6.4-3.7 10-10.2 10S5.5 29.4 5.5 23Z"
					/>
					<g class="csf48-motion csf48-look">
						<g fill="#fff" stroke-width="1.8">
							<rect
								x="6.5"
								y="20"
								width="8"
								height="5.8"
								rx="1.8"
							/>
							<rect
								x="17.5"
								y="20"
								width="8"
								height="5.8"
								rx="1.8"
							/>
						</g>
						<path d="M14.5 22h3" stroke-width="1.8" />
						<path
							class="csf48-motion csf48-mouth-normal"
							d="m14.2 28.7 1.5 1.2 1.5-1.2"
							stroke-width="1.5"
						/>
						<ellipse
							class="csf48-motion csf48-mouth-surprised"
							cx="15.7"
							cy="29"
							rx="1.1"
							ry="1.4"
							stroke-width="1.5"
						/>
						<path d="M3 27h3m19 0h3" stroke-width="1.5" />
					</g>
				</g>
			</g>

			<!-- 机に添えた前足・用紙は元のパスのまま。 -->
			<path
				d="M32 21.5l2 4.5c2.5 1 4.5 3 4.5 5 0 1.3-1.2 2-3 2h-4.8c-1.5 0-2.3-1-1.8-2.2.4-1.3 1.8-2.1 3.6-2.1"
			/>
			<g mask="url(#csf48-v2-paper-mask)">
				<path d="M17 36h12" stroke-width="1.6" />
				<path
					class="csf48-motion csf48-ink"
					d="M18 33h4"
					pathLength="1"
					stroke-width="1.5"
				/>
			</g>

			<!-- 放す瞬間までの前足とペン。 -->
			<g class="csf48-motion csf48-travel">
				<g class="csf48-motion csf48-wrist">
					<g class="csf48-motion csf48-recoil">
						<path
							class="csf48-motion csf48-held-pen"
							d="m8 22.4 3 2.9m5.5 6.1L18 33"
						/>
						<path
							d="M12 26c-4-1-6 4-2 6s8 0 7-3c-.5-1.5-2.5-2.5-5-3Z"
						/>
					</g>
				</g>
			</g>

			<!-- 同じ座標から離れ、天板で小さく跳ねるペン。 -->
			<g mask="url(#csf48-v2-paw-mask)">
				<g class="csf48-motion csf48-drop-visible">
					<path class="csf48-motion csf48-drop" d="M12 22.4 22 33" />
				</g>
			</g>

			<!-- 小さい表示でも読み取れる「ハッ」の記号。 -->
			<g class="csf48-motion csf48-alert">
				<path d="M40 8.5v4.5" />
				<circle
					cx="40"
					cy="16.5"
					r="1"
					fill="currentColor"
					stroke="none"
				/>
			</g>

			<path d="M4 40h40M8 40v5m32-5v5" />
		</svg>
	{/if}
</span>

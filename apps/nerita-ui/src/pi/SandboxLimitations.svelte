<!-- 現在の MXC で保証できない読み取り制限と、許可できない接続を説明する。 -->
<script lang="ts">
</script>

<section
	class="grid gap-3 rounded border border-input-border p-3 text-sm"
	aria-label="現在のMXCの制約"
>
	<h2 class="m-0 text-lg font-semibold">現在のMXCの制約</h2>
	<p class="m-0 text-muted">
		Windows側の対応待ちにより、現行のMXC
		BaseContainerには次の制約があります。
	</p>
	<ul class="m-0 grid gap-2 pl-5">
		<li>ワークスペース外の読み取りを防ぐことは保証できません。</li>
		<li>ホストからSandbox内へのループバック接続は許可できません。</li>
	</ul>
	<p class="m-0 text-muted">
		ワークスペース外への書き込み拒否と、外部への通信制御は確認済みです。
	</p>
</section>

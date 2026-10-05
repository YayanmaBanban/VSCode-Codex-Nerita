// Node のテストイベントから、失敗した仕様とアサーションを構造化して取り出す。
/** テスト出力の部分文字列を成功判定に使わず、準備例外も別の失敗として残す。 */
module.exports = async function* report(source) {
	for await (const event of source) {
		if (event.type !== "test:fail") {
			continue;
		}
		const failure = event.data.details.error;
		const assertion = failure.cause ?? failure;
		yield `${JSON.stringify({ name: event.data.name, code: assertion.code, type: failure.failureType, message: assertion.message, operator: assertion.operator, stack: assertion.stack })}\n`;
	}
};

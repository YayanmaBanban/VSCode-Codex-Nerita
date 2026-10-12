// 過去の検出漏れと誤検出を、TS/TSX の構文・診断位置・境界値で固定する。
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { parser } = require("typescript-eslint");
const plugin = require("../../../config/eslint/index.cjs");
const fixtures = require("./fixtures.cjs");

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
	languageOptions: {
		parser,
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});

tester.run(
	"no-complex-boolean-expression",
	plugin.rules["no-complex-boolean-expression"],
	{
		valid: [
			{
				filename: "view.tsx",
				code: "function View() { return ready && <><input disabled={busy || Boolean(binding)} />{binding && <input value={binding.id} />}</>; }",
			},
			{
				filename: "view.tsx",
				code: "function View() { return show ? <div>{enabled && <span />}{name || fallback()}</div> : null; }",
			},
			{
				filename: "view.tsx",
				code: "function View() { return ready && <div>{rows.map(row => row.active && <i>{row.name}</i>)}<input disabled={busy || Boolean(binding)} /></div>; }",
			},
			{
				filename: "binding.tsx",
				code: 'function BindingIdentity() { return <><input disabled={busy || Boolean(binding)} />{binding && <input type="hidden" value={binding.id} />}</>; }',
			},
			{
				filename: "view.tsx",
				code: "function View() { return <div>{ready && <span>{label || fallback()}</span>}{rows.map(row => <i>{row.name}</i>)}</div>; }",
			},
			{
				filename: "view.tsx",
				code: "function View() { return <>{ready && <span>{label || fallback()}</span>}{rows.map(row => <i>{row.name}</i>)}</>; }",
			},
			{
				filename: "view.tsx",
				code: "function View() { return <div>{ready && <i/>}{label || fallback()}</div> as Element; }",
			},
			"if (!(a < b && b < c)) {}",
			"if (!(a && b)) {}",
			"if (!isRecord(value)) returnFalse();",
			"function valid() { return a && keys.every(predicate); }",
			"if (!keys.every(key => typeof value[key] === 'string')) returnFalse();",
			"function valid() { return keys.every(key => typeof value[key] === 'string'); }",
			"function valid() { return a && (b || c); }",
			"function valid() { return ready && check(value); }",
			"function valid() { const valid = keys.every(key => value[key] === undefined || typeof value[key] === 'string'); if (!valid) return false; return valid; }",
			"function valid() { return ready && { predicate: () => rows.every(row => row.active && row.id) }; }",
			"function view() { return { busy: rows.some(row => row.active && row.ready) }; }",
			"function view() { return [{ busy: rows.some(row => row.active && row.ready) }]; }",
			"function valid() { return rows.every(row => { function other() { return left && right; } return row.active; }); }",
			"const valid = rows.every(row => row.active && row.id);",
			"const valid = a && b && c && d && e && f && g && h;",
			"const valid = left ?? right ?? fallback;",
			"const valid = ready && ok && validate(parse(clean(value)));",
			"const object = ready && { predicate: () => rows.every(row => row.active && row.id) && other.every(x => x.valid) };",
			{
				code: "const valid = ready && rows.every(row => row.active && row.id);",
				options: [{ maxScore: 4 }],
			},
			{
				code: "const valid = ready && ok && validate(parse(clean(value)));",
				options: [{ maxScore: 6 }],
			},
		],
		invalid: [
			{
				filename: "view.tsx",
				code: "function View() { return visible && <div>{ready && rows.every(row => row.active && row.id) && others.every(item => item.valid)}</div>; }",
				errors: [{ messageId: "separate", line: 1, column: 43 }],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return show ? <div>{ready && rows.every(row => row.active && row.id) && others.every(item => item.valid)}</div> : null; }",
				errors: [{ messageId: "separate", line: 1, column: 39 }],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return check() && (fallback || alternate) && <div>{ready && rows.every(row => row.active && row.id) && others.every(item => item.valid)}</div>; }",
				errors: [
					{ messageId: "mixed", line: 1, column: 26 },
					{ messageId: "separate", line: 1, column: 70 },
				],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return <div>{ready && rows.every(row => row.active && row.id) && others.every(item => item.valid)}</div>; }",
				errors: [{ messageId: "separate", line: 1, column: 32 }],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return <>{ready && rows.every(row => row.active && row.id) && others.every(item => item.valid)}</>; }",
				errors: [{ messageId: "separate", line: 1, column: 29 }],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return <div>{rows.map(row => { return row.active && (row.ready || validate(row)); })}</div>; }",
				errors: [{ messageId: "mixed", line: 1, column: 57 }],
				output: null,
			},
			{
				filename: "view.tsx",
				code: "function View() { return <div>{rows.map(row => { if (row.active && (row.ready || validate(row))) { return row.name; } return null; })}</div>; }",
				errors: [{ messageId: "mixed", line: 1, column: 54 }],
				output: null,
			},
			{
				code: 'if (!["threadId", "parentThreadId", "activityItemId", "agentPath"].every(key => typeof value[key] === "string" && value[key].length > 0)) { returnFalse(); }',
				errors: [{ messageId: "predicate", line: 1, column: 5 }],
				output: null,
			},
			{
				code: 'if (!["nickname", "role", "statusMessage", "model", "reasoningEffort", "lastAction"].every(key => value[key] === undefined || typeof value[key] === "string")) { returnFalse(); }',
				errors: [{ messageId: "predicate", line: 1, column: 5 }],
			},
			{
				code: "if (!(validTitle && (value.commandPermission === undefined || commandPermissionKeySchema.safeParse(value.commandPermission).success))) { returnFalse(); }",
				errors: [{ messageId: "mixed", line: 1, column: 5 }],
			},
			{
				code: 'if (!["cwd", "command"].every(key => value[key] === undefined || typeof value[key] === "string")) { returnFalse(); }',
				errors: [{ messageId: "predicate", line: 1, column: 5 }],
			},
			{
				code: 'function valid() { return ["fields", "details"].every(key => value[key] === undefined || everyRecord(value[key], isPermissionField)); }',
				errors: [{ messageId: "predicate", line: 1, column: 27 }],
			},
			{
				code: "function valid() { return a && (b || validate(value)); }",
				errors: [{ messageId: "mixed", line: 1, column: 27 }],
			},
			{
				code: "if (rows.some((row => row.active && row.ready) satisfies Predicate)) {}",
				errors: [{ messageId: "predicate", line: 1, column: 5 }],
			},
			{
				code: "function valid() { return rows.every(function(row) { return row.active && row.ready; }); }",
				errors: [{ messageId: "predicate", line: 1, column: 27 }],
			},
			{
				code: fixtures.permission,
				errors: [
					{ messageId: "mixed", line: 5, column: 6 },
					{ messageId: "separate", line: 14, column: 3 },
				],
				output: null,
			},
			{
				code: fixtures.subAgent,
				errors: [{ messageId: "separate", line: 3, column: 3 }],
				output: null,
			},
			{
				code: "const valid = ready && rows.every(row => row.active && row.id);",
				options: [{ maxScore: 3 }],
				errors: [
					{
						messageId: "separate",
						data: { score: 4, max: 3 },
						line: 1,
						column: 15,
					},
				],
			},
			{
				code: "const valid = ready && ok && validate(parse(clean(value)));",
				options: [{ maxScore: 5 }],
				errors: [
					{
						messageId: "separate",
						data: { score: 6, max: 5 },
						line: 1,
						column: 15,
					},
				],
			},
			{
				code: "const valid = a && rows.every((row => row.x && row.y && row.z) satisfies Predicate) && other.every(x => x.valid);",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
		],
	},
);

tester.run(
	"no-nested-ternary-expression",
	plugin.rules["no-nested-ternary-expression"],
	{
		valid: [
			"const value = flag ? left : right;",
			"const value = (a ? b : c) ? left : right;",
			"const value = flag ? () => child ? left : right : fallback;",
			"const value = flag ? { run() { return child ? left : right; } } : fallback;",
			"const value = flag ? { run: () => child ? left : right } : fallback;",
			"const value = items.map(item => item.ready ? item.left : item.right);",
			{
				filename: "view.tsx",
				code: "const view = flag ? <div>{label}</div> : <span>{label}</span>;",
			},
		],
		invalid: [
			{
				code: fixtures.recoverIntent,
				errors: [{ messageId: "separate", line: 10, column: 3 }],
				output: null,
			},
			{
				code: "const value = a ? b ? c : d : e;",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
			{
				code: "const value = a ? b : c ? d : e ? f : g;",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
			{
				code: "const value = flag ? items.map(function(item) { return item.ready ? item.left : item.right; }) : [];",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
			{
				code: "const value = flag ? rows.map((row => row.ready ? row.left : row.right) as Mapper) : [];",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
			{
				code: "const value = flag ? [{ label: child ? left : right }] : [];",
				errors: [{ messageId: "separate", line: 1, column: 15 }],
			},
			{
				filename: "view.tsx",
				code: "const view = flag ? <div>{items.map(item => item.ready ? <b /> : <i />)}</div> : null;",
				errors: [{ messageId: "separate", line: 1, column: 14 }],
			},
		],
	},
);

tester.run(
	"no-complex-inline-callback",
	plugin.rules["no-complex-inline-callback"],
	{
		valid: [
			"items.map(item => item.id);",
			"items.map(item => (\n item.id\n));",
			"new Date();",
			"open({ save: (value) => repository.save(value) });",
			"new Runtime(async () => { const value = await load(); return value; });",
			"const task = () => { first(); second(); third(); fourth(); };",
			"run(() => { one(); two(); three(); four(); five(); six(); seven(); eight(); });",
			"run({ get value() { one(); two(); three(); four(); five(); six(); seven(); eight(); nine(); } });",
			"items.map(item => { function separate() { one(); two(); three(); four(); five(); six(); seven(); eight(); nine(); } return separate(item); });",
			{
				code: "run(() => { one(); two(); });",
				options: [{ maxStatements: 2 }],
			},
			{
				code: "run(() => { if (a) { if (b) { return c; } } });",
				options: [{ maxControlDepth: 2 }],
			},
			{
				code: "run(async () => { await first(); await second(); });",
				options: [{ maxAwaits: 2 }],
			},
		],
		invalid: [
			{
				code: "run(flag ? () => { one(); two(); three(); } : fallback);",
				options: [{ maxStatements: 2 }],
				errors: [{ messageId: "separate", line: 1, column: 12 }],
			},
			{
				code: "run({ save() { one(); two(); three(); } });",
				options: [{ maxStatements: 2 }],
				errors: [{ messageId: "separate", line: 1, column: 11 }],
			},
			{
				code: `async function open() {\n${fixtures.runtime}\n}`,
				errors: [{ messageId: "separate", line: 10, column: 8 }],
				output: null,
			},
			{
				code: "run(() => { one(); two(); three(); });",
				options: [{ maxStatements: 2 }],
				errors: [{ messageId: "separate", line: 1, column: 5 }],
			},
			{
				code: "run(() => { if (a) { if (b) { return c; } } });",
				options: [{ maxControlDepth: 1 }],
				errors: [{ messageId: "separate", line: 1, column: 5 }],
			},
			{
				code: "run(async () => { await first(); await second(); });",
				options: [{ maxAwaits: 1 }],
				errors: [{ messageId: "separate", line: 1, column: 5 }],
			},
			{
				code: "new Runtime(function() { one(); two(); three(); four(); five(); six(); seven(); eight(); nine(); });",
				errors: [{ messageId: "separate", line: 1, column: 13 }],
			},
			{
				code: "run({ save: (() => { one(); two(); three(); }) satisfies Save });",
				options: [{ maxStatements: 2 }],
				errors: [{ messageId: "separate", line: 1, column: 14 }],
			},
			{
				code: "run([() => { one(); two(); three(); }]);",
				options: [{ maxStatements: 2 }],
				errors: [{ messageId: "separate", line: 1, column: 6 }],
			},
		],
	},
);

tester.run("no-await-in-condition", plugin.rules["no-await-in-condition"], {
	valid: [
		"async function run() { const trusted = await workspaceTrusted(); if (!trusted) return; }",
		"if (items.some(async item => await ready(item))) {}",
		"for (let i = 0; i < 3; i++) { await next(); }",
		"for (let i = 0; i < 3; await next()) { i++; }",
		"const choose = ready ? await left() : await right();",
		"for (;;) { await next(); }",
	],
	invalid: [
		{
			code: "if ((await ready()) ? left : right) {}",
			errors: [{ messageId: "separate", line: 1, column: 6 }],
		},
		{
			code: "if (!(await workspaceTrusted())) {}",
			errors: [{ messageId: "separate", line: 1, column: 7 }],
			output: null,
		},
		{
			code: "if (ready && await trusted()) {}",
			errors: [{ messageId: "separate", line: 1, column: 14 }],
		},
		{
			code: "while (await next()) {}",
			errors: [{ messageId: "separate", line: 1, column: 8 }],
		},
		{
			code: "do {} while (await next());",
			errors: [{ messageId: "separate", line: 1, column: 14 }],
		},
		{
			code: "for (; await next();) {}",
			errors: [{ messageId: "separate", line: 1, column: 8 }],
		},
		{
			code: "const choice = await ready() ? left : right;",
			errors: [{ messageId: "separate", line: 1, column: 16 }],
		},
		{
			code: "if ((await ready()) as boolean) {}",
			errors: [{ messageId: "separate", line: 1, column: 6 }],
		},
		{
			code: "if (await left() && await right()) {}",
			errors: [
				{ messageId: "separate", line: 1, column: 5 },
				{ messageId: "separate", line: 1, column: 21 },
			],
		},
	],
});

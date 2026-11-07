// シェル固有の Web cmdlet の引数定義を取得し、Pi の子シェル内だけに UA 上書きを追加する。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { PowerShellExecutable } from "../../runtime/PowerShellExecutable";
import { commandEnvironment } from "../../runtime/CommandEnvironment";
import { piShellCurl } from "./PiShellCurl";
import { piWebUserAgent } from "./PiWebTrust";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";

const definitions = z.array(
	z.object({
		name: z.enum(["Invoke-WebRequest", "Invoke-RestMethod"]),
		binding: z.string(),
		parameters: z.string(),
	}),
);
const metadata = new Map<string, Promise<z.infer<typeof definitions>>>();
const inspectCommands = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PSModulePath = $PSHOME + '\Modules'
Import-Module ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$items = foreach ($name in @('Invoke-WebRequest', 'Invoke-RestMethod')) {
    $command = Get-Command ('Microsoft.PowerShell.Utility\' + $name) -CommandType Cmdlet -ErrorAction Stop
    $metadata = New-Object System.Management.Automation.CommandMetadata $command
    [pscustomobject]@{
        name = $name
        binding = [System.Management.Automation.ProxyCommand]::GetCmdletBindingAttribute($metadata)
        parameters = [System.Management.Automation.ProxyCommand]::GetParamBlock($metadata)
    }
}
ConvertTo-Json -InputObject @($items) -Compress
`;

/** 通信可能な Pi シェルにだけ適用し、承認後にも同じ UA 設定であることを照合する。 */
export async function preparePiShellWebCommand(
	shell: PowerShellExecutable,
	body: string,
	policy: AgentAccessPolicy,
) {
	if (!policy.networkAccess && policy.hostLoopbackAccess !== true) {
		return { body, check: () => Promise.resolve() };
	}
	const userAgent = await piWebUserAgent();
	const protectedBody = await piShellWebCommand(shell, body, userAgent);
	return {
		body: protectedBody,
		async check() {
			const current = await piWebUserAgent();
			if (current !== userAgent) {
				throw new Error(
					"Web取得の User-Agent が変更されました。再接続してください。",
				);
			}
		},
	};
}

/** モデルのコマンドは Host で実行せず、信頼済みシェルの標準 cmdlet の定義だけを取得する。 */
async function inspectWebCommands(shell: PowerShellExecutable) {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(commandEnvironment())) {
		if (value !== null) {
			env[key] = value;
		}
	}
	const { stdout } = await promisify(execFile)(
		shell.executable,
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			inspectCommands,
		],
		{
			env,
			encoding: "utf8",
			windowsHide: true,
			timeout: 5000,
			maxBuffer: 262144,
		},
	);
	return definitions.parse(JSON.parse(stdout.replace(/^\uFEFF/, "")));
}

/** 設定値は PowerShell の単一引用符で囲んでエスケープし、モデルのコマンド本文は元の構文のまま実行する。 */
async function piShellWebCommand(
	shell: PowerShellExecutable,
	body: string,
	userAgent: string,
): Promise<string> {
	let pending = metadata.get(shell.executable);
	if (!pending) {
		pending = inspectWebCommands(shell).catch((error: unknown) => {
			metadata.delete(shell.executable);
			throw error;
		});
		metadata.set(shell.executable, pending);
	}
	const commands = await pending;
	return [
		`$script:NeritaWebUserAgent = '${userAgent.replaceAll("'", "''")}'`,
		...commands.map(webCommandProxy),
		piShellCurl,
		body,
	].join("\n");
}

/** 実行時に渡された `Headers` も検査するため、変数やスプラッティングで指定された UA にも適用する。 */
function webCommandProxy(command: z.infer<typeof definitions>[number]): string {
	const qualified = `Microsoft.PowerShell.Utility\\${command.name}`;
	return String.raw`
function ${command.name} {
    ${command.binding}
    param(${command.parameters})
    process {
        $PSBoundParameters['UserAgent'] = $script:NeritaWebUserAgent
        if ($PSBoundParameters.ContainsKey('Headers')) {
            $cleanHeaders = @{}
            foreach ($key in $PSBoundParameters['Headers'].Keys) {
                if ([string]$key -ine 'User-Agent') { $cleanHeaders[$key] = $PSBoundParameters['Headers'][$key] }
            }
            $PSBoundParameters['Headers'] = $cleanHeaders
        }
        & '${qualified}' @PSBoundParameters
        if ($PSBoundParameters.ContainsKey('SessionVariable')) {
            $sessionName = [string]$PSBoundParameters['SessionVariable']
            $createdSession = Get-Variable -Name $sessionName -ValueOnly -ErrorAction SilentlyContinue
            Set-Variable -Name $sessionName -Value $createdSession -Scope 1
        }
    }
}
`;
}

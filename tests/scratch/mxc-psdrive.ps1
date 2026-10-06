# mxc-psdrive.cjs が現行の MXC ポリシーで実行する。失敗した各操作を記録し、終了コードへ反映する。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$workspace = [Environment]::CurrentDirectory
$script:probeResults = @()

# 1つの失敗で後続の切り分けを省略せず、失敗を成功扱いにしない。
function Invoke-Probe([string]$Name, [scriptblock]$Action) {
    try {
        $text = (& $Action | Out-String).Trim()
        $script:probeResults += [pscustomobject]@{ name = $Name; passed = $true; output = $text }
    } catch {
        $script:probeResults += [pscustomobject]@{ name = $Name; passed = $false; error = $_.Exception.Message }
    }
}

try {
    New-PSDrive -Name Nerita -PSProvider FileSystem -Root $workspace | Out-Null
    Set-Location Nerita:\
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

Invoke-Probe 'Get-Location' {
    Get-Location | Format-List Path, ProviderPath
    if ((Get-Location).ProviderPath.TrimEnd('\') -ne $workspace.TrimEnd('\')) { throw 'ProviderPath mismatch' }
    'OS cwd: ' + [Environment]::CurrentDirectory
}
Invoke-Probe 'Get-Content package.json' {
    (Get-Content .\package.json -Raw | ConvertFrom-Json).name
}
Invoke-Probe 'node via PATH' {
    node -e "console.log(process.cwd())"
    if ($LASTEXITCODE -ne 0) { throw "node exit: $LASTEXITCODE" }
}
Invoke-Probe 'git status' {
    git --no-optional-locks status --short
    if ($LASTEXITCODE -ne 0) { throw "git exit: $LASTEXITCODE" }
}
Invoke-Probe 'pnpm --version' {
    pnpm --version
    if ($LASTEXITCODE -ne 0) { throw "pnpm exit: $LASTEXITCODE" }
}
Invoke-Probe 'node via canonical executable' {
    $actual = & (Get-Command node).Source -e "console.log(process.cwd())"
    if ($LASTEXITCODE -ne 0) { throw "node exit: $LASTEXITCODE" }
    if ($actual.TrimEnd('\') -ne $workspace.TrimEnd('\')) { throw 'Native cwd mismatch' }
    $actual
}
Invoke-Probe 'cmd cwd' {
    & "$env:SystemRoot\System32\cmd.exe" /d /c cd
    if ($LASTEXITCODE -ne 0) { throw "cmd exit: $LASTEXITCODE" }
}
Invoke-Probe 'pnpm.cmd --version' {
    pnpm.cmd --version
    if ($LASTEXITCODE -ne 0) { throw "pnpm.cmd exit: $LASTEXITCODE" }
}
Invoke-Probe 'git with explicit native cwd' {
    [Environment]::CurrentDirectory = (Get-Location).ProviderPath
    git --no-optional-locks -C $workspace status --short
    if ($LASTEXITCODE -ne 0) { throw "git exit: $LASTEXITCODE" }
}
$script:probeResults | ConvertTo-Json -Depth 4
if ($script:probeResults.Where({ -not $_.passed }).Count -gt 0) { exit 1 }

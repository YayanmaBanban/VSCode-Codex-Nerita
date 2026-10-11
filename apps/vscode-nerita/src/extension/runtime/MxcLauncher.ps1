# 標準入力の設定を、同じユーザーが所有し、起動した CLI だけが読めるパイプへ渡す。
param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

# PID の確認と終了通知はビルド済み DLL を使い、起動のたびにコンパイルしない。
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot 'nerita-mxc-pipe.dll'))

$name = 'nerita-mxc-' + [Guid]::NewGuid().ToString('N')
$security = New-Object System.IO.Pipes.PipeSecurity
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$security.SetOwner($identity.User)
$security.SetAccessRuleProtection($true, $false)
$rule = New-Object System.IO.Pipes.PipeAccessRule($identity.User, [System.IO.Pipes.PipeAccessRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$security.AddAccessRule($rule)
# 属性確認の切断直後に本文を開く CLI を待たせないよう、2つの待受けを先に用意する。
function New-ConfigPipe {
    New-Object System.IO.Pipes.NamedPipeServerStream($name, [System.IO.Pipes.PipeDirection]::Out, 3, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous, 4096, 65536, $security)
}
$pipes = @(1..2 | ForEach-Object { New-ConfigPipe })
[System.Threading.Tasks.Task[]]$connections = @($pipes | ForEach-Object { $_.WaitForConnectionAsync() })
$child = $null
try {
    $config = [Console]::In.ReadToEnd()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($config)
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = '--config \\.\pipe\' + $name
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $child = [System.Diagnostics.Process]::Start($start)
    $exited = [NeritaPipeClient]::WaitForExitAsync($child)
    $child.StandardInput.Close()
    $stdout = $child.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $stderr = $child.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    # CLI は属性確認でも接続する。本文を読む接続まで同じ起動 PID を確認し続ける。
    while (-not $child.HasExited) {
        # 接続と終了を同時に待ち、終了後のポーリング待ちをなくす。
        [System.Threading.Tasks.Task[]]$waits = @($connections) + @($exited)
        $index = [System.Threading.Tasks.Task]::WaitAny($waits)
        if ($index -eq $connections.Length -or $child.HasExited) { break }
        [void]$connections[$index].GetAwaiter().GetResult()
        $pipe = $pipes[$index]
        [uint32]$clientId = 0
        if (-not [NeritaPipeClient]::GetNamedPipeClientProcessId($pipe.SafePipeHandle, [ref]$clientId)) {
            throw 'MXC の設定パイプの読み手を確認できません。'
        }
        try {
            if ($clientId -eq $child.Id) {
                $pipe.Write($bytes, 0, $bytes.Length)
                # 読み終える前に閉じると Windows が未読のバッファを破棄するため、読取りを待つ。
                $pipe.WaitForPipeDrain()
            }
        } catch [System.IO.IOException] {
            # 属性確認は本文を読まずに閉じる。CLI が終了した場合も下の終了待ちへ進む。
        } finally {
            # Disconnect は Rust のファイル読取りで EOF にならないため、ハンドルを閉じる。
            # 次の待受けを先に作り、属性確認と本文読取りの間に利用可能な接続を維持する。
            $next = New-ConfigPipe
            $connections[$index] = $next.WaitForConnectionAsync()
            $pipe.Dispose()
            $pipes[$index] = $next
        }
    }
    $child.WaitForExit()
    [void]$stdout.GetAwaiter().GetResult()
    [void]$stderr.GetAwaiter().GetResult()
    exit $child.ExitCode
} finally {
    foreach ($pipe in $pipes) { $pipe.Dispose() }
    if ($null -ne $child) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}

// Pi の PowerShell 内で curl の実引数を検査し、転送ごとに設定済み UA を適用する。

/** 通常のコマンド解決だけを対象とし、ファイルや curl 内で展開するヘッダーは送信前に拒否する。 */
export const piShellCurl = String.raw`
function Invoke-NeritaCurl {
    $native = Get-Command curl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    # curl 自身の引数定義を使い、本文やファイル名をオプションとして誤解釈しない。
    $options = @{}
    $short = @{}
    foreach ($line in (& $native.Source -q --help all)) {
        if ($line -cmatch '^\s+(?:-(?<short>[^,]),\s+)?(?<long>--[a-z0-9-]+)\s+(?<value><\S+>)?') {
            $entry = @{ name = $Matches['long']; value = [bool]$Matches['value'] }
            $options[$entry.name] = $entry
            if ($Matches['short']) { $short[[int][char]$Matches['short']] = $entry }
        }
    }
    if (-not $options.ContainsKey('--user-agent') -or -not $options.ContainsKey('--header')) {
        throw 'Nerita: could not read curl options; no request was sent.'
    }
    $forward = @('-q')
    $tail = $false
    for ($i = 0; $i -lt $args.Count; $i++) {
        $item = [string]$args[$i]
        if ($tail) { $forward += $item; continue }
        if ($item -ceq '--') {
            $forward += @('--user-agent', $script:NeritaWebUserAgent, '--')
            $tail = $true
            continue
        }
        if (-not $item.StartsWith('-') -or $item -ceq '-') { $forward += $item; continue }
        $pending = @()
        if ($item.StartsWith('--')) {
            $parts = $item -split '=', 2
            $option = $parts[0]
            # 一意な長名の省略や変数展開は、推測して処理しない。
            if (-not $options.ContainsKey($option)) { throw 'Nerita: use complete supported curl option names.' }
            $entry = $options[$option]
            $value = $null
            if ($parts.Count -eq 2) {
                if (-not $entry.value) { throw 'Nerita: curl flag does not take a value.' }
                $value = $parts[1]
            }
            $pending += @{ entry = $entry; value = $value }
        } else {
            for ($j = 1; $j -lt $item.Length; $j++) {
                $key = [int][char]$item.Substring($j, 1)
                if (-not $short.ContainsKey($key)) { throw 'Nerita: unknown curl short option.' }
                $entry = $short[$key]
                $value = $null
                if ($entry.value -and $j + 1 -lt $item.Length) { $value = $item.Substring($j + 1) }
                $pending += @{ entry = $entry; value = $value }
                if ($entry.value) { break }
            }
        }
        foreach ($parsed in $pending) {
            $name = $parsed.entry.name
            $value = $parsed.value
            if ($name -ceq '--config') {
                throw 'Nerita: curl config files are unsupported; use explicit arguments.'
            }
            if ($parsed.entry.value -and $null -eq $value) {
                $i++
                if ($i -ge $args.Count) { throw 'Nerita: curl option has no value.' }
                $value = [string]$args[$i]
            }
            if ($name -ceq '--user-agent') { continue }
            if ($name -ceq '--next') {
                $forward += @('--user-agent', $script:NeritaWebUserAgent, '--next')
                continue
            }
            if ($name -ceq '--header' -or $name -ceq '--proxy-header') {
                if ($value.StartsWith('@') -or $value -match '[\r\n]') {
                    throw 'Nerita: curl header files and multiline headers are unsupported.'
                }
                if ($value -match '^\s*User-Agent\s*[:;]') { continue }
            }
            $forward += $name
            if ($parsed.entry.value) { $forward += $value }
        }
    }
    if (-not $tail) { $forward += @('--user-agent', $script:NeritaWebUserAgent) }
    & $native.Source @forward
}
function curl.exe { Invoke-NeritaCurl @args }
# Windows PowerShell の curl エイリアスは Web cmdlet のラッパーを使い続ける。
if (-not (Get-Alias curl -ErrorAction SilentlyContinue)) {
    function curl { Invoke-NeritaCurl @args }
}
`;

@echo off
rem スキルの配置からリポジトリルートを補い、スクリプト名と残りの引数を渡す。
setlocal DisableDelayedExpansion

if "%~1"=="" (
    >&2 echo Usage: %~nx0 ^<script^> [options] [file-or-directory ...]
    exit /b 2
)

pnpm.cmd --dir "%~dp0." run %* --root "%~dp0..\..\.."

// 設定パイプの読み手を OS の PID で検証し、CLI の終了を待機タスクへ通知する。
// Windows PowerShell 5.1 の CLR で読み込める DLL をビルド時に生成する。
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class NeritaPipeClient
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);

    public static Task WaitForExitAsync(Process child)
    {
        var completed = new TaskCompletionSource<bool>();
        EventHandler handler = null;
        handler = (sender, args) =>
        {
            child.Exited -= handler;
            completed.TrySetResult(true);
        };
        child.Exited += handler;
        child.EnableRaisingEvents = true;
        // 登録前に終了した場合も通知する。イベントと競合しても一度だけ完了する。
        if (child.HasExited)
        {
            handler(child, EventArgs.Empty);
        }
        return completed.Task;
    }
}

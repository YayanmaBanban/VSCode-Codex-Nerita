// 固定のWin32 broker。入力をコードへ埋め込まず、共有削除・共有書込みを禁止したハンドルで境界を保持する。
export const windowsFileSource = String.raw`
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class NeritaFiles {
    // 開いた実体の種類・link数を同じhandleから取得する。
    [StructLayout(LayoutKind.Sequential)]
    struct Info {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out uint flags, uint size);

    // canonical DOS pathだけを受け付け、別名やSMBの共有モード差を許可しない。
    static void Validate(string path) {
        if (String.IsNullOrEmpty(path) || !System.Text.RegularExpressions.Regex.IsMatch(path, @"^[A-Za-z]:\\"))
            throw new IOException("Local absolute paths required");
        if (path.Substring(3).IndexOfAny(new char[]{':','<','>','\"','|','?','*','/'}) >= 0 || path.Any(c => c < 32))
            throw new IOException("Special path denied");
        foreach (var part in path.Substring(3).Split('\\')) {
            if (part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") ||
                System.Text.RegularExpressions.Regex.IsMatch(part, @"^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                throw new IOException("Special path denied");
        }
    }
    // realpath済みの表記を厳密比較し、case属性変更でも隣接rootへ移れなくする。
    static bool Within(string root, string path) {
        return path.Equals(root, StringComparison.Ordinal) || path.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.Ordinal);
    }
    // 保護対象とroot自体の変更を副作用の前に拒否する。
    static void Allowed(string path, string[] roots, string[] blocked, bool write) {
        if (!roots.Any(r => Within(r, path)) || blocked.Any(r => Within(r, path)) ||
            (write && roots.Any(r => path.Equals(r, StringComparison.Ordinal))))
            throw new IOException("Filesystem policy denied");
    }
    // OPEN_ALWAYSはtruncateしない。実体の種類・link数を確認した後だけ内容を変更する。
    static SafeFileHandle Open(string path, bool write, bool directory, bool create) {
        // 属性参照だけのhandleでは共有モードがrenameを阻止しないため、directoryにもGENERIC_READを要求する。
        var handle = CreateFile(path, write ? 0xC0000000u : 0x80000000u, 1, IntPtr.Zero,
            create ? 4u : 3u, 0x00200000u | 0x02000000u, IntPtr.Zero);
        if (handle.IsInvalid) { var code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
        try {
            Info info;
            if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.Attributes & 0x400) != 0 || (((info.Attributes & 0x10) != 0) != directory) || (!directory && info.Links != 1))
                throw new IOException("Reparse point, hard link or unexpected file type denied");
            var actual = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, actual, (uint)actual.Capacity, 0);
            if (length == 0 || length >= actual.Capacity || !actual.ToString().Equals(@"\\?\" + path, StringComparison.Ordinal))
                throw new IOException("Canonical path changed");
            if (directory) {
                uint flags;
                if (!GetFileInformationByHandleEx(handle, 23, out flags, 4) || (flags & 1) != 0)
                    throw new IOException("Case-sensitive or unsupported directory denied");
            }
            return handle;
        } catch { handle.Dispose(); throw; }
    }
    // driveから順に固定する。途中のjunction化・renameもI/O終了まで許可しない。
    static void Pin(string directory, bool create, string[] roots, string[] blocked, List<SafeFileHandle> handles) {
        string current = directory.Substring(0, 3);
        handles.Add(Open(current, false, true, false));
        foreach (string part in directory.Substring(3).Split(new char[]{'\\'}, StringSplitOptions.RemoveEmptyEntries)) {
            current = Path.Combine(current, part);
            try { handles.Add(Open(current, false, true, false)); }
            catch (Win32Exception ex) {
                if (!create || (ex.NativeErrorCode != 2 && ex.NativeErrorCode != 3)) throw;
                Allowed(current, roots, blocked, true);
                Directory.CreateDirectory(current);
                handles.Add(Open(current, false, true, false));
            }
        }
    }
    // 固定のfile操作だけをdispatchし、すべてのhandleを例外時にも回収する。
    public static object Run(string operation, string path, string[] roots, string[] blocked, string content) {
        Validate(path);
        foreach (var root in roots.Concat(blocked)) Validate(root);
        bool write = operation == "write" || operation == "mkdir";
        Allowed(path, roots, blocked, write && operation != "mkdir");
        var handles = new List<SafeFileHandle>();
        try {
            if (operation == "mkdir" || operation == "list") {
                Pin(path, operation == "mkdir", roots, blocked, handles);
                if (operation == "mkdir") return true;
                return Directory.GetFileSystemEntries(path).Select(p => Path.GetFileName(p)).ToArray();
            }
            Pin(Path.GetDirectoryName(path), false, roots, blocked, handles);
            if (operation == "stat") {
                // statも内容読取り用ハンドルと同じ検証を通す。
                bool directory = (File.GetAttributes(path) & FileAttributes.Directory) != 0;
                handles.Add(Open(path, false, directory, false));
                return directory;
            }
            using (var file = Open(path, write, false, write))
            using (var stream = new FileStream(file, write ? FileAccess.ReadWrite : FileAccess.Read)) {
                if (operation == "write") {
                    byte[] data = Convert.FromBase64String(content);
                    stream.SetLength(0);
                    stream.Write(data, 0, data.Length);
                    stream.Flush(true);
                    return true;
                }
                if (operation != "read" && operation != "image") throw new IOException("Unknown operation");
                if (stream.Length > 32 * 1024 * 1024 && operation == "read") throw new IOException("File exceeds 32 MiB");
                using (var output = new MemoryStream()) {
                    if (operation == "image") { var bytes = new byte[12]; int n = stream.Read(bytes, 0, 12); output.Write(bytes, 0, n); }
                    else stream.CopyTo(output);
                    return Convert.ToBase64String(output.ToArray());
                }
            }
        } finally { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); }
    }
}
`;

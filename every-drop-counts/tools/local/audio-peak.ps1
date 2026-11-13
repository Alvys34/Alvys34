# Prints the peak output level of every audio session on the default playback device, per
# process, sampled N times. Proves a process is actually producing sound without listening.
#   powershell -NoProfile -File tools/local/audio-peak.ps1 [-Samples 20] [-IntervalMs 250] [-Match EveryDropCounts]
param([int]$Samples = 20, [int]$IntervalMs = 250, [string]$Match = '')
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport] class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref Guid iid, int dwClsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionManager2 { int NotImpl1(); int NotImpl2(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl2 s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl2 { int a1(); int a2(); int a3(); int a4(); int a5(); int a6(); int a7(); int a8(); int a9(); int b1(); int b2(); int GetProcessId(out uint pid); }
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioMeterInformation { int GetPeakValue(out float p); }
public static class Peaks {
  public static string Sample() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator()); IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid g = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref g, 23, IntPtr.Zero, out o);
    IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se); int n; se.GetCount(out n);
    var sb = new System.Text.StringBuilder();
    for (int i = 0; i < n; i++) { IAudioSessionControl2 s; se.GetSession(i, out s); uint pid; s.GetProcessId(out pid); float pk; ((IAudioMeterInformation)s).GetPeakValue(out pk); sb.Append(pid).Append('=').Append(pk.ToString("0.000")).Append(' '); }
    return sb.ToString();
  }
}
'@
$names = @{}
for ($i = 0; $i -lt $Samples; $i++) {
  $line = [Peaks]::Sample()
  $out = @()
  foreach ($kv in $line.Trim().Split(' ')) {
    if (-not $kv) { continue }
    $pid_, $pk = $kv.Split('=')
    if (-not $names.ContainsKey($pid_)) { try { $names[$pid_] = (Get-Process -Id $pid_ -ErrorAction Stop).ProcessName } catch { $names[$pid_] = "pid$pid_" } }
    if ($Match -and $names[$pid_] -notlike "*$Match*") { continue }
    $out += "$($names[$pid_])=$pk"
  }
  Write-Output ($out -join ' ')
  Start-Sleep -Milliseconds $IntervalMs
}

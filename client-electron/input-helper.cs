using System;
using System.Runtime.InteropServices;
using System.Globalization;

class InputHelper {
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("gdi32.dll")]
    static extern bool SetDeviceGammaRamp(IntPtr hDC, ref RAMP lpRamp);

    [DllImport("gdi32.dll")]
    static extern bool GetDeviceGammaRamp(IntPtr hDC, ref RAMP lpRamp);

    [DllImport("user32.dll")]
    static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct RAMP {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
        public UInt16[] Red;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
        public UInt16[] Green;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)]
        public UInt16[] Blue;
    }

    static RAMP originalRamp;
    static bool hasOriginalRamp = false;
    static volatile bool isCurtainActive = false;
    static System.Threading.Thread curtainThread = null;

    static void StartCurtainLoop() {
        if (isCurtainActive) return;
        isCurtainActive = true;

        try {
            IntPtr hDC = GetDC(IntPtr.Zero);
            if (hDC != IntPtr.Zero) {
                if (!hasOriginalRamp) {
                    originalRamp = new RAMP();
                    if (GetDeviceGammaRamp(hDC, ref originalRamp)) {
                        hasOriginalRamp = true;
                    }
                }
                ReleaseDC(IntPtr.Zero, hDC);
            }
        } catch { }

        curtainThread = new System.Threading.Thread(() => {
            RAMP blackRamp = new RAMP();
            blackRamp.Red = new UInt16[256];
            blackRamp.Green = new UInt16[256];
            blackRamp.Blue = new UInt16[256];
            for (int i = 0; i < 256; i++) {
                blackRamp.Red[i] = 0;
                blackRamp.Green[i] = 0;
                blackRamp.Blue[i] = 0;
            }

            while (isCurtainActive) {
                try {
                    IntPtr hDC = GetDC(IntPtr.Zero);
                    if (hDC != IntPtr.Zero) {
                        SetDeviceGammaRamp(hDC, ref blackRamp);
                        ReleaseDC(IntPtr.Zero, hDC);
                    }
                } catch { }
                System.Threading.Thread.Sleep(30);
            }
        });
        curtainThread.IsBackground = true;
        curtainThread.Priority = System.Threading.ThreadPriority.Highest;
        curtainThread.Start();
    }

    static void StopCurtainLoop() {
        isCurtainActive = false;
        if (curtainThread != null) {
            try { curtainThread.Join(150); } catch { }
            curtainThread = null;
        }
        RestoreMonitor();
    }

    static void RestoreMonitor() {
        try {
            IntPtr hDC = GetDC(IntPtr.Zero);
            if (hDC != IntPtr.Zero) {
                if (hasOriginalRamp) {
                    SetDeviceGammaRamp(hDC, ref originalRamp);
                } else {
                    RAMP defaultRamp = new RAMP();
                    defaultRamp.Red = new UInt16[256];
                    defaultRamp.Green = new UInt16[256];
                    defaultRamp.Blue = new UInt16[256];
                    for (int i = 0; i < 256; i++) {
                        ushort val = (ushort)(i * 256);
                        defaultRamp.Red[i] = val;
                        defaultRamp.Green[i] = val;
                        defaultRamp.Blue[i] = val;
                    }
                    SetDeviceGammaRamp(hDC, ref defaultRamp);
                }
                ReleaseDC(IntPtr.Zero, hDC);
            }
            SendMessage((IntPtr)0xFFFF, WM_SYSCOMMAND, (IntPtr)SC_MONITORPOWER, (IntPtr)(-1));
            mouse_event(0x0001, 1, 1, 0, 0);
        } catch { }
    }

    const uint WM_SYSCOMMAND = 0x0112;
    const int SC_MONITORPOWER = 0xF170;

    const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    const uint MOUSEEVENTF_LEFTUP = 0x04;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
    const uint MOUSEEVENTF_RIGHTUP = 0x10;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x20;
    const uint MOUSEEVENTF_MIDDLEUP = 0x40;
    const uint MOUSEEVENTF_WHEEL = 0x0800;

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYDOWN = 0x0000;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static void Main(string[] args) {
        Console.WriteLine("INPUT_HELPER_READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                if (string.IsNullOrEmpty(line)) continue;
                string[] parts = line.Split(' ');
                string command = parts[0].ToLower();

                if (command == "movenorm" && parts.Length >= 3) {
                    float nx = float.Parse(parts[1], CultureInfo.InvariantCulture);
                    float ny = float.Parse(parts[2], CultureInfo.InvariantCulture);
                    int screenW = GetSystemMetrics(0);
                    int screenH = GetSystemMetrics(1);
                    if (screenW <= 0) screenW = 1920;
                    if (screenH <= 0) screenH = 1080;

                    int targetX = (int)Math.Round(nx * screenW);
                    int targetY = (int)Math.Round(ny * screenH);
                    SetCursorPos(targetX, targetY);
                }
                else if (command == "move" && parts.Length >= 3) {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    SetCursorPos(x, y);
                } 
                else if (command == "click" && parts.Length >= 2) {
                    string button = parts[1].ToLower();
                    if (button == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (button == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else if (button == "middle") {
                        mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
                    }
                } 
                else if (command == "mousedown" && parts.Length >= 2) {
                    string button = parts[1].ToLower();
                    if (button == "left") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    else if (button == "right") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                    else if (button == "middle") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
                } 
                else if (command == "mouseup" && parts.Length >= 2) {
                    string button = parts[1].ToLower();
                    if (button == "left") mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    else if (button == "right") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    else if (button == "middle") mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
                } 
                else if (command == "scroll" && parts.Length >= 2) {
                    int deltaY = int.Parse(parts[1]);
                    int amount = -deltaY;
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)amount, 0);
                }
                else if (command == "keydown" && parts.Length >= 2) {
                    byte vk = byte.Parse(parts[1]);
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, 0, flags, 0);
                }
                else if (command == "keyup" && parts.Length >= 2) {
                    byte vk = byte.Parse(parts[1]);
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, 0, flags | KEYEVENTF_KEYUP, 0);
                }
                else if (command == "curtainon") {
                    StartCurtainLoop();
                }
                else if (command == "curtainoff") {
                    StopCurtainLoop();
                }
            } catch (Exception ex) {
                Console.WriteLine("ERROR: " + ex.Message);
            }
        }
    }
}

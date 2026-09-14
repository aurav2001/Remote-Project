using System;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Diagnostics;
using System.Threading;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Security.AccessControl;

class InputHelper {
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

    // DPI awareness — without this, GetSystemMetrics returns the DPI-SCALED (logical)
    // resolution on displays scaled to 125%/150%, while the actual screen has more
    // physical pixels, so screen capture ends up cut off on the right/bottom.
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [DllImport("shcore.dll")]
    static extern int SetProcessDpiAwareness(int value); // 2 = PROCESS_PER_MONITOR_DPI_AWARE

    [DllImport("user32.dll", SetLastError = true)]
    static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    static extern bool LockWorkStation();

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, [Out] byte[] pvInfo, uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll", SetLastError = true)]
    static extern IntPtr CreateDC(string lpszDriver, string lpszDevice, string lpszOutput, IntPtr lpInitData);

    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, uint dwRop);

    [DllImport("sas.dll", SetLastError = true)]
    static extern void SendSAS(bool asUser);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLengthInBytes, IntPtr PreviousState, IntPtr ReturnLength);

    [StructLayout(LayoutKind.Sequential)]
    struct LUID {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES {
        public uint PrivilegeCount;
        public LUID Luid;
        public uint Attributes;
    }

    const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    const uint TOKEN_QUERY = 0x0008;
    const uint SE_PRIVILEGE_ENABLED = 0x00000002;

    const uint DESKTOP_ALL_ACCESS = 0x01FF;
    const uint DESKTOP_READOBJECTS = 0x0001;
    const uint DESKTOP_WRITEOBJECTS = 0x0004;
    const uint DESKTOP_SWITCHDESKTOP = 0x0100;
    const int UOI_NAME = 2;

    const uint SRCCOPY = 0x00CC0020;

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
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_SCANCODE = 0x0008;

    const byte VK_LWIN = 0x5B;     // 91
    const byte VK_CONTROL = 0x11;  // 17
    const byte VK_MENU = 0x12;     // 18 (Alt)
    const byte VK_SHIFT = 0x10;    // 16
    const byte VK_DELETE = 0x2E;   // 46
    const byte VK_ESCAPE = 0x1B;   // 27
    const byte VK_SPACE = 0x20;    // 32
    const byte VK_RETURN = 0x0D;   // 13
    const byte VK_BACK = 0x08;     // 8
    const byte VK_TAB = 0x09;      // 9
    const byte VK_D = 0x44;        // 68
    const byte VK_E = 0x45;        // 69
    const byte VK_L = 0x4C;        // 76
    const byte VK_R = 0x52;        // 82
    const byte VK_V = 0x56;        // 86
    const byte VK_C = 0x43;        // 67
    const byte VK_X = 0x58;        // 88
    const byte VK_A = 0x41;        // 65

    static int currentDisplayX = 0;
    static int currentDisplayY = 0;
    static int currentDisplayW = 0;
    static int currentDisplayH = 0;
    static IntPtr activeDesktop = IntPtr.Zero;
    static string lastReportedDesktop = "";

    // Enable process token privileges for full Windows subsystem access
    static void EnableTokenPrivileges() {
        try {
            IntPtr hToken;
            if (OpenProcessToken(Process.GetCurrentProcess().Handle, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out hToken)) {
                string[] privs = new string[] { "SeDebugPrivilege", "SeTcbPrivilege", "SeShutdownPrivilege", "SeIncreaseWorkingSetPrivilege", "SeAssignPrimaryTokenPrivilege", "SeIncreaseQuotaPrivilege" };
                foreach (string p in privs) {
                    try {
                        LUID luid;
                        if (LookupPrivilegeValue(null, p, out luid)) {
                            TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
                            tp.PrivilegeCount = 1;
                            tp.Luid = luid;
                            tp.Attributes = SE_PRIVILEGE_ENABLED;
                            AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
                        }
                    } catch {}
                }
            }
        } catch {}
    }

    // Dynamically switch current thread to whatever desktop is active (Winlogon, Default, ScreenSaver, UAC)
    static void SyncDesktop() {
        try {
            IntPtr hDesktop = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);
            if (hDesktop == IntPtr.Zero) {
                hDesktop = OpenInputDesktop(0, false, DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_SWITCHDESKTOP);
            }
            if (hDesktop != IntPtr.Zero) {
                if (hDesktop != activeDesktop) {
                    SetThreadDesktop(hDesktop);
                    if (activeDesktop != IntPtr.Zero) {
                        try { CloseDesktop(activeDesktop); } catch {}
                    }
                    activeDesktop = hDesktop;
                }

                // Query desktop name
                try {
                    byte[] info = new byte[256];
                    uint needed;
                    if (GetUserObjectInformation(hDesktop, UOI_NAME, info, (uint)info.Length, out needed)) {
                        string name = Encoding.Unicode.GetString(info, 0, (int)needed).Replace("\0", "").Trim();
                        if (name != lastReportedDesktop) {
                            lastReportedDesktop = name;
                            if (name.Equals("Winlogon", StringComparison.OrdinalIgnoreCase)) {
                                Console.WriteLine("DESKTOP_IS_WINLOGON");
                            } else if (name.Equals("Default", StringComparison.OrdinalIgnoreCase)) {
                                Console.WriteLine("DESKTOP_IS_DEFAULT");
                            } else {
                                Console.WriteLine("DESKTOP_NAME " + name);
                            }
                        }
                    }
                } catch {}
            }
        } catch {}
    }

    static void ReleaseAllModifiers() {
        try {
            SyncDesktop();
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_LWIN, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_DELETE, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, 0);
        } catch {}
    }

    static void PressKeyWithScan(byte vk) {
        try {
            SyncDesktop();
            byte scan = (byte)MapVirtualKey((uint)vk, 0);
            uint ext = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
            keybd_event(vk, scan, ext, 0);
            Thread.Sleep(25);
            keybd_event(vk, scan, ext | KEYEVENTF_KEYUP, 0);
        } catch {}
    }

    static void PressKeyCombo(params byte[] keys) {
        if (keys == null || keys.Length == 0) return;
        try {
            SyncDesktop();
            for (int i = 0; i < keys.Length; i++) {
                byte vk = keys[i];
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                keybd_event(vk, scan, flags, 0);
            }
            Thread.Sleep(25);
            for (int i = keys.Length - 1; i >= 0; i--) {
                byte vk = keys[i];
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                keybd_event(vk, scan, flags | KEYEVENTF_KEYUP, 0);
            }
            Thread.Sleep(10);
            ReleaseAllModifiers();
        } catch (Exception ex) {
            Console.WriteLine("COMBO_ERROR: " + ex.Message);
        }
    }

    static void TypeChar(char c) {
        try {
            SyncDesktop();
            if (c >= '0' && c <= '9') {
                byte vk = (byte)c;
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                keybd_event(vk, scan, 0, 0);
                Thread.Sleep(25);
                keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
            } else if (c >= 'a' && c <= 'z') {
                byte vk = (byte)(c - 'a' + 0x41);
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                keybd_event(vk, scan, 0, 0);
                Thread.Sleep(25);
                keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
            } else if (c >= 'A' && c <= 'Z') {
                byte vk = (byte)c;
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                byte shiftScan = (byte)MapVirtualKey((uint)VK_SHIFT, 0);
                keybd_event(VK_SHIFT, shiftScan, 0, 0);
                Thread.Sleep(15);
                keybd_event(vk, scan, 0, 0);
                Thread.Sleep(25);
                keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
                Thread.Sleep(15);
                keybd_event(VK_SHIFT, shiftScan, KEYEVENTF_KEYUP, 0);
            } else {
                keybd_event(0, (byte)c, KEYEVENTF_UNICODE, 0);
                Thread.Sleep(25);
                keybd_event(0, (byte)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0);
            }
            Thread.Sleep(15);
        } catch {}
    }

    static void TypeText(string text) {
        if (string.IsNullOrEmpty(text)) return;
        try {
            SyncDesktop();
            for (int i = 0; i < text.Length; i++) {
                TypeChar(text[i]);
            }
            Console.WriteLine("TYPED_TEXT_LEN: " + text.Length);
        } catch (Exception ex) {
            Console.WriteLine("TYPE_ERROR: " + ex.Message);
        }
    }

    static void TriggerSasUnlock() {
        try {
            SyncDesktop();
            try {
                SendSAS(false);
            } catch {}

            // Secure Attention Sequence (Ctrl + Alt + Del)
            keybd_event(VK_CONTROL, 0x1D, 0, 0);
            keybd_event(VK_MENU, 0x38, 0, 0);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY, 0);
            Thread.Sleep(50);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU, 0x38, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, 0);
            ReleaseAllModifiers();

            Thread.Sleep(150);
            SyncDesktop();
            PressKeyWithScan(VK_SPACE);
            Thread.Sleep(150);
            PressKeyWithScan(VK_ESCAPE);
            Thread.Sleep(150);

            // Click middle of screen to ensure password input focus
            int screenW = GetSystemMetrics(0);
            int screenH = GetSystemMetrics(1);
            if (screenW <= 0) screenW = 1920;
            if (screenH <= 0) screenH = 1080;
            SetCursorPos(screenW / 2, (int)(screenH * 0.58));
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

            Console.WriteLine("SAS_UNLOCK_DISPATCHED");
            Thread.Sleep(250);
            CaptureDesktopFrame();
        } catch (Exception ex) {
            Console.WriteLine("SAS_ERROR: " + ex.Message);
        }
    }

    static void UnlockWithPin(string pin) {
        if (string.IsNullOrEmpty(pin)) return;
        try {
            SyncDesktop();

            // 1. Wake screen and clear lock screen curtain / dismiss screensaver
            PressKeyWithScan(VK_SPACE);
            Thread.Sleep(200);
            PressKeyWithScan(VK_ESCAPE);
            Thread.Sleep(200);

            // 2. Click in center of screen where Windows Credential Provider PIN/Password input box is located
            SyncDesktop();
            int screenW = GetSystemMetrics(0);
            int screenH = GetSystemMetrics(1);
            if (screenW <= 0) screenW = 1920;
            if (screenH <= 0) screenH = 1080;
            int pinX = screenW / 2;
            int pinY = (int)(screenH * 0.58);
            SetCursorPos(pinX, pinY);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            Thread.Sleep(150);

            // 3. Clear any existing characters in PIN box (Ctrl+A then Backspaces)
            PressKeyCombo(VK_CONTROL, VK_A);
            Thread.Sleep(40);
            PressKeyWithScan(VK_BACK);
            Thread.Sleep(20);
            for (int b = 0; b < 10; b++) {
                PressKeyWithScan(VK_BACK);
                Thread.Sleep(10);
            }
            Thread.Sleep(60);

            // 4. Type each PIN character
            TypeText(pin);
            Thread.Sleep(120);

            // 5. Submit Enter key
            SyncDesktop();
            PressKeyWithScan(VK_RETURN);
            Console.WriteLine("PIN_UNLOCK_COMPLETED");

            // 6. Capture immediate frames for fast visual feedback
            Thread.Sleep(250);
            CaptureDesktopFrame();
            Thread.Sleep(500);
            CaptureDesktopFrame();
        } catch (Exception ex) {
            Console.WriteLine("PIN_UNLOCK_ERROR: " + ex.Message);
        }
    }

    private static ImageCodecInfo GetEncoder(ImageFormat format) {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs) {
            if (codec.FormatID == format.Guid) {
                return codec;
            }
        }
        return null;
    }

    static void CaptureDesktopFrame() {
        try {
            SyncDesktop();
            int screenW = GetSystemMetrics(0);
            int screenH = GetSystemMetrics(1);
            if (screenW <= 0) screenW = 1920;
            if (screenH <= 0) screenH = 1080;

            int targetW = screenW > 1280 ? 1280 : screenW;
            int targetH = (int)Math.Round((double)targetW * screenH / screenW);

            using (Bitmap bmp = new Bitmap(screenW, screenH, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(bmp)) {
                    // On the lock/secure desktop (Winlogon), Graphics.CopyFromScreen throws every
                    // single frame — catching that CLR exception per frame is expensive. So when we
                    // are NOT on the normal "Default" desktop, go straight to GDI BitBlt and skip it.
                    bool onSecureDesktop = (lastReportedDesktop != null &&
                        !lastReportedDesktop.Equals("Default", StringComparison.OrdinalIgnoreCase) &&
                        lastReportedDesktop.Length > 0);
                    bool copied = false;
                    if (!onSecureDesktop) {
                        try {
                            g.CopyFromScreen(0, 0, 0, 0, new Size(screenW, screenH), CopyPixelOperation.SourceCopy);
                            copied = true;
                        } catch {}
                    }

                    if (!copied) {
                        IntPtr hdcDest = g.GetHdc();
                        IntPtr hdcSrc = GetDC(IntPtr.Zero);
                        bool needDelete = false;
                        if (hdcSrc == IntPtr.Zero) {
                            hdcSrc = CreateDC("DISPLAY", null, null, IntPtr.Zero);
                            needDelete = true;
                        }
                        BitBlt(hdcDest, 0, 0, screenW, screenH, hdcSrc, 0, 0, SRCCOPY);
                        if (needDelete) {
                            DeleteDC(hdcSrc);
                        } else {
                            ReleaseDC(IntPtr.Zero, hdcSrc);
                        }
                        g.ReleaseHdc(hdcDest);
                    }
                }

                Bitmap outputBmp = bmp;
                Bitmap scaled = null;
                if (targetW != screenW || targetH != screenH) {
                    scaled = new Bitmap(targetW, targetH);
                    using (Graphics gScaled = Graphics.FromImage(scaled)) {
                        gScaled.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                        gScaled.DrawImage(bmp, 0, 0, targetW, targetH);
                    }
                    outputBmp = scaled;
                }

                try {
                    using (MemoryStream ms = new MemoryStream()) {
                        ImageCodecInfo jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                        EncoderParameters myEncoderParameters = new EncoderParameters(1);
                        myEncoderParameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 55L);
                        outputBmp.Save(ms, jpgEncoder, myEncoderParameters);
                        string b64 = Convert.ToBase64String(ms.ToArray());
                        Console.WriteLine("FRAME_JPG " + b64);
                    }
                } finally {
                    if (scaled != null) {
                        scaled.Dispose();
                    }
                }
            }
        } catch (Exception ex) {
            Console.WriteLine("CAPTURE_ERROR: " + ex.Message);
        }
    }

    static void ProcessCommand(string line) {
            try {
                if (string.IsNullOrEmpty(line)) return;
                string[] parts = line.Split(' ');
                string command = parts[0].ToLower();

                // Re-sync desktop before processing every input command
                SyncDesktop();

                if (command == "captureframe") {
                    CaptureDesktopFrame();
                }
                else if (command == "unlockwithpin" && parts.Length >= 2) {
                    string pin = line.Substring(parts[0].Length).Trim();
                    UnlockWithPin(pin);
                }
                else if (command == "setdisplaybounds" && parts.Length >= 5) {
                    currentDisplayX = int.Parse(parts[1]);
                    currentDisplayY = int.Parse(parts[2]);
                    currentDisplayW = int.Parse(parts[3]);
                    currentDisplayH = int.Parse(parts[4]);
                }
                else if (command == "movenorm" && parts.Length >= 3) {
                    float nx = float.Parse(parts[1], CultureInfo.InvariantCulture);
                    float ny = float.Parse(parts[2], CultureInfo.InvariantCulture);
                    int screenW = GetSystemMetrics(0);
                    int screenH = GetSystemMetrics(1);
                    if (screenW <= 0) screenW = 1920;
                    if (screenH <= 0) screenH = 1080;

                    int baseW = currentDisplayW > 0 ? currentDisplayW : screenW;
                    int baseH = currentDisplayH > 0 ? currentDisplayH : screenH;

                    int targetX = currentDisplayX + (int)Math.Round(nx * baseW);
                    int targetY = currentDisplayY + (int)Math.Round(ny * baseH);
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
                    byte scan = (byte)MapVirtualKey((uint)vk, 0);
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, scan, flags, 0);
                }
                else if (command == "keyup" && parts.Length >= 2) {
                    byte vk = byte.Parse(parts[1]);
                    byte scan = (byte)MapVirtualKey((uint)vk, 0);
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, scan, flags | KEYEVENTF_KEYUP, 0);
                    if (vk == VK_DELETE) {
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
                        keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, 0);
                    }
                }
                else if (command == "typeb64" && parts.Length >= 2) {
                    byte[] data = Convert.FromBase64String(parts[1]);
                    string decoded = Encoding.UTF8.GetString(data);
                    TypeText(decoded);
                }
                else if (command == "type" || command == "typepin") {
                    string text = line.Substring(parts[0].Length).Trim();
                    TypeText(text);
                }
                else if (command == "enter" || command == "submit") {
                    PressKeyWithScan(VK_RETURN);
                }
                else if (command == "backspace") {
                    PressKeyWithScan(VK_BACK);
                }
                else if (command == "space") {
                    PressKeyWithScan(VK_SPACE);
                }
                else if (command == "tab") {
                    PressKeyWithScan(VK_TAB);
                }
                else if (command == "releaseallmodifiers" || command == "resetkeys") {
                    ReleaseAllModifiers();
                }
                else if (command == "syncdesktop") {
                    SyncDesktop();
                    Console.WriteLine("DESKTOP_SYNCED");
                }
                else if (command == "sas" || command == "unlock" || command == "wakescreen") {
                    TriggerSasUnlock();
                }
                else if (command == "combo" && parts.Length >= 2) {
                    byte[] keys = new byte[parts.Length - 1];
                    for (int i = 1; i < parts.Length; i++) {
                        keys[i - 1] = byte.Parse(parts[i]);
                    }
                    PressKeyCombo(keys);
                }
                else if (command == "shortcut" && parts.Length >= 2) {
                    string sc = parts[1].ToLower().Replace("-", "").Replace("_", "");
                    if (sc == "ctrldel") {
                        keybd_event(VK_CONTROL, 0x1D, 0, 0);
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY, 0);
                        Thread.Sleep(30);
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
                        keybd_event(VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, 0);
                        ReleaseAllModifiers();
                    }
                    else if (sc == "ctrlaltdel" || sc == "sas" || sc == "unlock") {
                        TriggerSasUnlock();
                    }
                    else if (sc == "taskmgr" || sc == "ctrlshiftesc") {
                        PressKeyCombo(VK_CONTROL, VK_SHIFT, VK_ESCAPE);
                        try { Process.Start("taskmgr.exe"); } catch {}
                    }
                    else if (sc == "lock" || sc == "winl") {
                        ReleaseAllModifiers();
                        LockWorkStation();
                    }
                    else if (sc == "showdesktop" || sc == "wind") {
                        PressKeyCombo(VK_LWIN, VK_D);
                    }
                    else if (sc == "run" || sc == "winr") {
                        PressKeyCombo(VK_LWIN, VK_R);
                    }
                    else if (sc == "explorer" || sc == "wine") {
                        PressKeyCombo(VK_LWIN, VK_E);
                    }
                    else if (sc == "altf4") {
                        PressKeyCombo(VK_MENU, 0x73);
                    }
                    else if (sc == "ctrlv" || sc == "paste") {
                        PressKeyCombo(VK_CONTROL, VK_V);
                    }
                    else if (sc == "ctrlc" || sc == "copy") {
                        PressKeyCombo(VK_CONTROL, VK_C);
                    }
                    else if (sc == "ctrlx" || sc == "cut") {
                        PressKeyCombo(VK_CONTROL, VK_X);
                    }
                    else if (sc == "ctrla" || sc == "selectall") {
                        PressKeyCombo(VK_CONTROL, VK_A);
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("ERROR: " + ex.Message);
            }
    }

    // ================= Entry point dispatch =================
    // Default (no args): user-session input helper (stdin) — handles normal mouse/keyboard.
    // --service     : plain SYSTEM loop (launched by a SYSTEM scheduled task in session 0).
    //                 Its only job is to spawn the --lockworker as SYSTEM into the ACTIVE
    //                 user session, so it can reach the Winlogon (lock) secure desktop.
    // --lockworker  : runs as SYSTEM inside the active session. Captures the lock screen and
    //                 injects the unlock PIN, talking to the host over a dedicated named pipe.
    static void Main(string[] args) {
        // NOTE: DPI awareness is applied ONLY inside the lock worker (RunLockWorker), not here.
        // Making the normal input helper DPI-aware changed GetSystemMetrics and shifted the
        // mouse coordinate mapping (cursor landed offset from the technician's pointer). The
        // input helper must keep the same (logical) metrics it always used.
        EnableTokenPrivileges();
        string mode = (args != null && args.Length > 0) ? args[0].ToLower().TrimStart('-') : "";

        if (mode == "service") { RunServiceLauncher(); return; }
        if (mode == "lockworker") { RunLockWorker(); return; }

        // Default user-session input helper (unchanged behaviour: reads stdin, writes stdout).
        SyncDesktop();
        ReleaseAllModifiers();
        Console.WriteLine("INPUT_HELPER_READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            ProcessCommand(line);
        }
    }

    // ===== SYSTEM lock worker (runs inside the active user session as SYSTEM) =====
    const string LOCK_PIPE = "RemoteITLockPipe";

    static void RunLockWorker() {
        // DPI-aware ONLY here so the lock-screen capture is full physical resolution
        // (no right/bottom cut on scaled displays). Does not affect input mapping.
        try { SetProcessDpiAwareness(2); } catch { try { SetProcessDPIAware(); } catch {} }
        LogDiag("worker", "Lock worker started. Identity=" + SafeIdentity());
        // Until a host connects, swallow all output so writes to an invalid console never throw.
        try { Console.SetOut(TextWriter.Null); } catch {}

        // NOTE: The worker is fully PASSIVE. It does NOT run a background monitor and does
        // NOT capture on its own. It only acts on explicit commands from the host over the
        // pipe (captureframe / unlockwithpin / ...). Lock/unlock is detected by the host's
        // Electron powerMonitor (reliable), which drives capture ONLY while locked. This is
        // what keeps the worker completely idle during normal use — no autonomous SyncDesktop
        // spam, no desktop-state flapping, and therefore no blink/flicker on connect.
        // Single command thread also means no cross-thread desktop race while capturing.

        // Accept host connections on the dedicated lock pipe (reconnect-safe loop).
        while (true) {
            try {
                PipeSecurity ps = new PipeSecurity();
                try {
                    ps.AddAccessRule(new PipeAccessRule(
                        new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                        PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
                        AccessControlType.Allow));
                    ps.AddAccessRule(new PipeAccessRule(
                        new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
                        PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
                        AccessControlType.Allow));
                } catch {}

                using (NamedPipeServerStream pipe = new NamedPipeServerStream(
                    LOCK_PIPE, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 65536, 65536, ps)) {
                    LogDiag("worker", "Pipe created, waiting for host connection...");
                    pipe.WaitForConnection();
                    LogDiag("worker", "Host connected to lock pipe.");

                    StreamWriter w = new StreamWriter(pipe, new UTF8Encoding(false));
                    w.AutoFlush = true;
                    StreamReader r = new StreamReader(pipe, new UTF8Encoding(false));

                    try { Console.SetOut(w); } catch {}
                    // Force a fresh desktop-state report to the newly connected host.
                    lastReportedDesktop = "";
                    try { SyncDesktop(); } catch {}
                    Console.WriteLine("LOCKWORKER_READY");

                    string line;
                    while ((line = r.ReadLine()) != null) {
                        LogDiag("worker", "cmd: " + (line.Length > 40 ? line.Substring(0, 40) + "..." : line) + " | desktop=" + lastReportedDesktop);
                        ProcessCommand(line);
                    }
                }
            } catch (Exception ex) { LogDiag("worker", "pipe loop error: " + ex.Message); }
            try { Console.SetOut(TextWriter.Null); } catch {}
            Thread.Sleep(500);
        }
    }

    // ===== Diagnostic log (SYSTEM launcher + worker run detached, so log to a file) =====
    static readonly object logLock = new object();
    static void LogDiag(string tag, string msg) {
        try {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "UnioTechIT");
            try { Directory.CreateDirectory(dir); } catch {}
            string file = Path.Combine(dir, "lockdiag.log");
            lock (logLock) {
                File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + tag + "] " + msg + "\r\n");
            }
        } catch {}
    }

    // ===== SYSTEM launcher: spawns the lock worker into the active session =====
    static PROCESS_INFORMATION currentWorker;
    static uint currentWorkerSession = 0xFFFFFFFF;

    static void RunServiceLauncher() {
        LogDiag("service", "Launcher started. Identity=" + SafeIdentity());
        while (true) {
            try {
                uint sid = WTSGetActiveConsoleSessionId();
                if (sid != 0xFFFFFFFF) {
                    bool needLaunch = (sid != currentWorkerSession);
                    if (!needLaunch && currentWorker.dwProcessId != 0) {
                        try {
                            Process p = Process.GetProcessById((int)currentWorker.dwProcessId);
                            if (p.HasExited) needLaunch = true;
                        } catch { needLaunch = true; }
                    } else if (currentWorker.dwProcessId == 0) {
                        needLaunch = true;
                    }
                    if (needLaunch) {
                        LogDiag("service", "Active console session=" + sid + " -> launching lock worker");
                        LaunchWorkerInSession(sid);
                    }
                }
            } catch (Exception ex) { LogDiag("service", "loop error: " + ex.Message); }
            Thread.Sleep(3000);
        }
    }

    static string SafeIdentity() {
        try { return WindowsIdentity.GetCurrent().Name; } catch { return "?"; }
    }

    static void LaunchWorkerInSession(uint sessionId) {
        IntPtr hToken = IntPtr.Zero;
        IntPtr hDup = IntPtr.Zero;
        try {
            // Duplicate this SYSTEM process's own token and retarget it at the active session,
            // then launch the worker as SYSTEM inside that interactive session.
            if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TOKEN_ALL_ACCESS, out hToken)) {
                LogDiag("launch", "OpenProcessToken FAILED err=" + Marshal.GetLastWin32Error());
                return;
            }
            if (!DuplicateTokenEx(hToken, MAXIMUM_ALLOWED, IntPtr.Zero,
                    (int)SECURITY_IMPERSONATION_LEVEL_Impersonation, (int)TOKEN_TYPE_Primary, out hDup)) {
                LogDiag("launch", "DuplicateTokenEx FAILED err=" + Marshal.GetLastWin32Error());
                return;
            }

            uint sid = sessionId;
            bool setOk = SetTokenInformation(hDup, TokenSessionId, ref sid, sizeof(uint));
            if (!setOk) LogDiag("launch", "SetTokenInformation(session) warn err=" + Marshal.GetLastWin32Error());

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.lpDesktop = "winsta0\\default";

            string exe = Process.GetCurrentProcess().MainModule.FileName;
            string cmd = "\"" + exe + "\" --lockworker";

            PROCESS_INFORMATION pi;
            bool ok = CreateProcessAsUser(hDup, null, cmd, IntPtr.Zero, IntPtr.Zero, false,
                CREATE_NO_WINDOW, IntPtr.Zero, null, ref si, out pi);
            if (ok) {
                currentWorker = pi;
                currentWorkerSession = sessionId;
                LogDiag("launch", "CreateProcessAsUser OK pid=" + pi.dwProcessId + " session=" + sessionId);
                try { CloseHandle(pi.hThread); } catch {}
            } else {
                LogDiag("launch", "CreateProcessAsUser FAILED err=" + Marshal.GetLastWin32Error() + " (1314=privilege not held)");
            }
        } catch (Exception ex) {
            LogDiag("launch", "exception: " + ex.Message);
        } finally {
            if (hDup != IntPtr.Zero) { try { CloseHandle(hDup); } catch {} }
            if (hToken != IntPtr.Zero) { try { CloseHandle(hToken); } catch {} }
        }
    }

    // ===== P/Invoke for session-aware SYSTEM process launching =====
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes,
        int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, ref uint TokenInformation, uint TokenInformationLength);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr hToken, string lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    const uint TOKEN_ALL_ACCESS = 0xF01FF;
    const uint MAXIMUM_ALLOWED = 0x02000000;
    const int SECURITY_IMPERSONATION_LEVEL_Impersonation = 2;
    const int TOKEN_TYPE_Primary = 1;
    const int TokenSessionId = 12;
    const uint CREATE_NO_WINDOW = 0x08000000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }
}


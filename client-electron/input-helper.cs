using System;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Diagnostics;
using System.Threading;
using System.Text;

class InputHelper {
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

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

    [DllImport("sas.dll", SetLastError = true)]
    static extern void SendSAS(bool asUser);

    const uint DESKTOP_ALL_ACCESS = 0x01FF;

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

    // Dynamically switch current thread to whatever desktop is active (Winlogon, Default, ScreenSaver, UAC)
    static void SyncDesktop() {
        try {
            IntPtr hDesktop = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);
            if (hDesktop != IntPtr.Zero && hDesktop != activeDesktop) {
                SetThreadDesktop(hDesktop);
                if (activeDesktop != IntPtr.Zero) {
                    try { CloseDesktop(activeDesktop); } catch {}
                }
                activeDesktop = hDesktop;
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
            // 1. If it's a standard digit '0'-'9' (e.g. for PINs)
            if (c >= '0' && c <= '9') {
                byte vk = (byte)(0x30 + (c - '0'));
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                keybd_event(vk, scan, 0, 0);
                Thread.Sleep(20);
                keybd_event(vk, scan, KEYEVENTF_KEYUP, 0);
            }
            // 2. Letters and symbols via Unicode & Scan code
            else {
                keybd_event(0, (byte)c, KEYEVENTF_UNICODE, 0);
                Thread.Sleep(20);
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
            // 1. Try Windows native SendSAS
            try {
                SendSAS(false);
            } catch {}

            // 2. Simulate Secure Attention Sequence (Ctrl + Alt + Delete) with exact hardware scan codes
            keybd_event(VK_CONTROL, 0x1D, 0, 0);
            keybd_event(VK_MENU, 0x38, 0, 0);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY, 0);
            Thread.Sleep(50);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU, 0x38, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, 0);
            ReleaseAllModifiers();

            // 3. Dismiss lock screen wallpaper & focus PIN box
            Thread.Sleep(100);
            SyncDesktop();
            PressKeyWithScan(VK_SPACE);
            Thread.Sleep(50);
            PressKeyWithScan(VK_RETURN);
            
            Console.WriteLine("SAS_UNLOCK_DISPATCHED");
        } catch (Exception ex) {
            Console.WriteLine("SAS_ERROR: " + ex.Message);
        }
    }

    static void Main(string[] args) {
        SyncDesktop();
        ReleaseAllModifiers();
        Console.WriteLine("INPUT_HELPER_READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                if (string.IsNullOrEmpty(line)) continue;
                string[] parts = line.Split(' ');
                string command = parts[0].ToLower();

                // Re-sync desktop before processing every input command
                SyncDesktop();

                if (command == "setdisplaybounds" && parts.Length >= 5) {
                    currentDisplayX = int.Parse(parts[1]);
                    currentDisplayY = int.Parse(parts[2]);
                    currentDisplayW = int.Parse(parts[3]);
                    currentDisplayH = int.Parse(parts[4]);
                }
                else if (command == "movenorm" && parts.Length >= 3) {
                    float nx = float.Parse(parts[1], CultureInfo.InvariantCulture);
                    float ny = float.Parse(parts[2], CultureInfo.InvariantCulture);
                    int screenW = GetSystemMetrics(0); // Primary Screen Width
                    int screenH = GetSystemMetrics(1); // Primary Screen Height
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
    }
}

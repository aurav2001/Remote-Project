using System;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Diagnostics;
using System.Threading;

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
    static extern bool LockWorkStation();

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr GetThreadDesktop(int dwThreadId);

    [DllImport("kernel32.dll")]
    static extern int GetCurrentThreadId();

    [DllImport("sas.dll", SetLastError = true)]
    static extern void SendSAS(bool asUser);

    const uint DESKTOP_ALL_ACCESS = 0x01FF;
    const uint DESKTOP_SWITCHDESKTOP = 0x0100;
    const uint DESKTOP_WRITEOBJECTS = 0x0080;
    const uint DESKTOP_READOBJECTS = 0x0001;

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

    const byte VK_LWIN = 0x5B;     // 91
    const byte VK_CONTROL = 0x11;  // 17
    const byte VK_MENU = 0x12;     // 18 (Alt)
    const byte VK_SHIFT = 0x10;    // 16
    const byte VK_DELETE = 0x2E;   // 46
    const byte VK_ESCAPE = 0x1B;   // 27
    const byte VK_SPACE = 0x20;    // 32
    const byte VK_RETURN = 0x0D;   // 13
    const byte VK_F4 = 0x73;       // 115
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

    // Dynamically switch current thread to whatever desktop is active (Winlogon, Default, ScreenSaver, UAC)
    static void SyncDesktop() {
        try {
            IntPtr hDesktop = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);
            if (hDesktop == IntPtr.Zero) {
                hDesktop = OpenInputDesktop(0, false, 0x01FF);
            }
            if (hDesktop != IntPtr.Zero) {
                SetThreadDesktop(hDesktop);
                CloseDesktop(hDesktop);
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

    static void PressKeyCombo(params byte[] keys) {
        if (keys == null || keys.Length == 0) return;
        try {
            SyncDesktop();
            // 1. Press keys down in order
            for (int i = 0; i < keys.Length; i++) {
                byte vk = keys[i];
                uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                keybd_event(vk, 0, flags, 0);
            }
            // 2. Exact 20ms debounce for Windows message pump registration
            Thread.Sleep(20);
            // 3. Release keys up in reverse order
            for (int i = keys.Length - 1; i >= 0; i--) {
                byte vk = keys[i];
                uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                keybd_event(vk, 0, flags | KEYEVENTF_KEYUP, 0);
                keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
            }
            // 4. Guarantee modifiers and delete are fully released
            Thread.Sleep(10);
            ReleaseAllModifiers();
        } catch (Exception ex) {
            Console.WriteLine("COMBO_ERROR: " + ex.Message);
        }
    }

    static void TriggerSasUnlock() {
        try {
            SyncDesktop();
            // 1. Try Windows native SendSAS if available
            try {
                SendSAS(false);
            } catch {}

            // 2. Simulate Secure Attention Sequence (Ctrl + Alt + Delete)
            keybd_event(VK_CONTROL, 0, 0, 0);
            keybd_event(VK_MENU, 0, 0, 0);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY, 0);
            keybd_event(VK_DELETE, 0, 0, 0);
            Thread.Sleep(50);
            keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
            keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
            ReleaseAllModifiers();

            // 3. Dismiss lock screen cover / dismiss wallpaper to focus password/PIN box
            Thread.Sleep(80);
            SyncDesktop();
            keybd_event(VK_SPACE, 0, 0, 0);
            Thread.Sleep(20);
            keybd_event(VK_SPACE, 0, KEYEVENTF_KEYUP, 0);
            
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

                // Re-sync desktop before processing commands
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
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, 0, flags, 0);
                }
                else if (command == "keyup" && parts.Length >= 2) {
                    byte vk = byte.Parse(parts[1]);
                    uint flags = (vk >= 33 && vk <= 46) ? KEYEVENTF_EXTENDEDKEY : 0;
                    keybd_event(vk, 0, flags | KEYEVENTF_KEYUP, 0);
                    if (vk == VK_DELETE) {
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
                        keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, 0);
                    }
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
                        keybd_event(VK_CONTROL, 0, 0, 0);
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY, 0);
                        keybd_event(VK_DELETE, 0, 0, 0);
                        Thread.Sleep(30);
                        keybd_event(VK_DELETE, 0x53, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
                        keybd_event(VK_DELETE, 0, KEYEVENTF_KEYUP, 0);
                        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
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
                        PressKeyCombo(VK_MENU, VK_F4);
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

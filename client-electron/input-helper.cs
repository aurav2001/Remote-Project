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

    static int currentDisplayX = 0;
    static int currentDisplayY = 0;
    static int currentDisplayW = 0;
    static int currentDisplayH = 0;

    static void Main(string[] args) {
        Console.WriteLine("INPUT_HELPER_READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                if (string.IsNullOrEmpty(line)) continue;
                string[] parts = line.Split(' ');
                string command = parts[0].ToLower();

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
                }
            } catch (Exception ex) {
                Console.WriteLine("ERROR: " + ex.Message);
            }
        }
    }
}

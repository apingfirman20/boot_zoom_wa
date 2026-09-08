Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\BOT AI ZOOM"
WshShell.Run """C:\Program Files\nodejs\node.exe"" ""d:\BOT AI ZOOM\bot.js""", 0, False


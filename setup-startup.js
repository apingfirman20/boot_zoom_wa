import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const startupFolder = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutPath = path.join(startupFolder, 'BotWhatsAppZoom.lnk');
const targetVbs = 'd:\\BOT AI ZOOM\\start-bot-silent.vbs';

const vbsCreatorScript = path.join(os.tmpdir(), 'create_shortcut.vbs');
const vbsContent = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath.replace(/\\/g, '\\\\')}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "wscript.exe"
oLink.Arguments = """${targetVbs}"""
oLink.WorkingDirectory = "d:\\BOT AI ZOOM"
oLink.Description = "WhatsApp Bot Zoom AI Auto-Start"
oLink.Save
`;

fs.writeFileSync(vbsCreatorScript, vbsContent, 'utf-8');
execSync(`cscript //nologo "${vbsCreatorScript}"`);
fs.unlinkSync(vbsCreatorScript);

console.log('✅ Shortcut berhasil dipasang di Windows Startup!');
console.log('Lokasi:', shortcutPath);

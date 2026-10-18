import { execFile } from 'node:child_process';
import type { ChildProcess, ExecFileException, ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { join } from 'node:path';
import { CredentialVault } from './vault';

const WINDOWS_PROMPT = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.Form
$dialog.Text = 'Rovdo API key'; $dialog.Width = 440; $dialog.Height = 185
$dialog.StartPosition = 'CenterScreen'; $dialog.FormBorderStyle = 'FixedDialog'
$dialog.MaximizeBox = $false; $dialog.MinimizeBox = $false; $dialog.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Enter the API key for the profile selected in Rovdo.'
$label.SetBounds(18,15,390,25)
$entry = New-Object System.Windows.Forms.TextBox
$entry.UseSystemPasswordChar = $true; $entry.SetBounds(18,45,390,25)
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Store in OS vault'; $ok.SetBounds(150,85,140,30); $ok.DialogResult = 'OK'
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'; $cancel.SetBounds(300,85,108,30); $cancel.DialogResult = 'Cancel'
$dialog.Controls.AddRange(@($label,$entry,$ok,$cancel))
$dialog.AcceptButton = $ok; $dialog.CancelButton = $cancel
if ($dialog.ShowDialog() -eq 'OK') {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::Write($entry.Text)
}
$entry.Clear(); $dialog.Dispose()
`;

function windowsPrompt(dark: boolean): string {
  const palette = dark ? ['#101725', '#edf2fa', '#182132'] : ['#f5f6f8', '#202633', '#ffffff'];
  const theme = `$dialog.BackColor = [System.Drawing.ColorTranslator]::FromHtml('${palette[0]}')
$dialog.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('${palette[1]}')
foreach ($control in @($label,$entry,$ok,$cancel)) { $control.ForeColor = $dialog.ForeColor; $control.BackColor = [System.Drawing.ColorTranslator]::FromHtml('${palette[2]}') }
$ok.UseVisualStyleBackColor = $false; $cancel.UseVisualStyleBackColor = $false
`;
  return WINDOWS_PROMPT.replace('$dialog.AcceptButton', theme + '$dialog.AcceptButton');
}

// Only main process owns this pipe. Secrets never enter command arguments,
// environment variables, shell history, renderer fields or persisted files.
export type PromptRunner = (file: string, args: string[], options: ExecFileOptionsWithStringEncoding, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => ChildProcess;
export async function promptForApiKey(platform: NodeJS.Platform = process.platform, execute: PromptRunner = execFile, dark = false): Promise<string | null> {
  const [executable, args]: [string, string[]] = platform === 'win32'
    ? [join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsPrompt(dark), 'utf16le').toString('base64')]]
    : platform === 'darwin'
      ? ['/usr/bin/osascript', ['-e', 'text returned of (display dialog "Enter the API key for the profile selected in Rovdo." default answer "" with hidden answer with title "Rovdo API key" buttons {"Cancel", "Store in OS vault"} default button "Store in OS vault")']]
      : ['/usr/bin/zenity', ['--password', '--title=Rovdo API key']];
  return await new Promise((resolve, reject) => {
    execute(executable, args, { windowsHide: true, timeout: 120_000, maxBuffer: 8192, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1 && (platform === 'linux' || (platform === 'darwin' && stderr.includes('(-128)')))) resolve(null);
        else reject(new Error('CREDENTIAL_ENTRY_UNAVAILABLE'));
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

export function createNativeVault(isDark: () => boolean = () => false): CredentialVault {
  return new CredentialVault((account) => {
    const load = async () => {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry('Rovdo', account, { linux: { store: 'secret-service' } });
    };
    return {
      getPassword: async () => (await load()).getPassword(),
      setPassword: async (value) => (await load()).setPassword(value),
      deleteCredential: async () => (await load()).deleteCredential(),
    };
  }, () => promptForApiKey(process.platform, execFile, isDark()));
}

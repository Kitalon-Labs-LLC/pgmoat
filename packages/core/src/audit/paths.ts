import os from 'node:os';
import path from 'node:path';

/**
 * Returns the default audit directory for the operating system.
 *
 * - Linux / POSIX: $XDG_STATE_HOME/pgmoat/audit or ~/.local/state/pgmoat/audit
 * - macOS (darwin): ~/Library/Application Support/pgmoat/audit
 * - Windows (win32): %LOCALAPPDATA%\pgmoat\audit
 */
export function getDefaultAuditDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix;

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || p.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local');
    return p.join(localAppData, 'pgmoat', 'audit');
  }

  if (platform === 'darwin') {
    const home = env.HOME || os.homedir();
    return p.join(home, 'Library', 'Application Support', 'pgmoat', 'audit');
  }

  // Linux and other POSIX
  if (env.XDG_STATE_HOME) {
    return p.join(env.XDG_STATE_HOME, 'pgmoat', 'audit');
  }
  const home = env.HOME || os.homedir();
  return p.join(home, '.local', 'state', 'pgmoat', 'audit');
}

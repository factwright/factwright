/** Where the user's Claude Code stands. The sidebar shows it, and runs start only when it's ready. */
export type ClaudeStatus =
  | { state: 'ready'; version: string; plan?: string | undefined }
  | { state: 'signed-out'; version: string }
  | { state: 'too-old'; version: string; minimum: string }
  | { state: 'missing' }
  | { state: 'unknown' };

/** What the app's window may ask of the main process. Nothing else crosses over. */
export interface FactwrightApi {
  /** The operating system, so the window can make room for its title bar buttons. */
  platform: string;
  claudeStatus(): Promise<ClaudeStatus>;
}

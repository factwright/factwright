/** Where the user's Claude Code stands. The sidebar shows it, and runs start only when it's ready. */
export type ClaudeStatus =
  | { state: 'ready'; version: string; plan?: string | undefined }
  | { state: 'signed-out'; version: string }
  | { state: 'too-old'; version: string; minimum: string }
  | { state: 'missing' }
  | { state: 'unknown' };

/** Where a run in Claude's panel stands. Claude Code's hooks report it, and so does its exit. */
export type RunSignal = 'working' | 'needs-answer' | 'done' | 'stopped' | 'failed';

/** The size of Claude's panel, in characters. */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Whether a run started, and if not, why. */
export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'not-ready' | 'busy' | 'failed'; message?: string };

/** What the app's window may ask of the main process. Nothing else crosses over. */
export interface FactwrightApi {
  /** The operating system, so the window can make room for its title bar buttons. */
  platform: string;
  claudeStatus(): Promise<ClaudeStatus>;
  /** Starts the user's Claude Code in the panel. Only one run happens at a time. */
  startClaude(size: TerminalSize): Promise<StartResult>;
  stopClaude(): void;
  /** Sends what the user types in the panel to Claude Code. */
  writeToClaude(data: string): void;
  resizeClaude(size: TerminalSize): void;
  /** Listens for Claude Code's output. Returns a function that stops listening. */
  onClaudeOutput(listener: (data: string) => void): () => void;
  /** Listens for changes in where the run stands. Returns a function that stops listening. */
  onClaudeSignal(listener: (signal: RunSignal) => void): () => void;
}

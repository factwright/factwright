import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Locks text with the system's keychain. In the app it's Electron's safe storage. */
export interface Keychain {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(locked: Buffer): string;
}

/** What sync says when there's no keychain to lock its secrets with. */
export const NO_KEYCHAIN_MESSAGE = 'This computer’s keychain isn’t available.';

/**
 * No keychain at all, for a copy of the app that mustn't reach the system's: sync can't turn on,
 * and secrets kept in its data folder stay locked.
 */
export const NO_KEYCHAIN: Keychain = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error(NO_KEYCHAIN_MESSAGE);
  },
  decryptString: () => {
    throw new Error(NO_KEYCHAIN_MESSAGE);
  },
};

/** What sync keeps secret on this computer. */
export type SecretName = 'session' | 'accountKey';

/**
 * Sync's secrets on this computer: the session token and the account key. Each is locked with
 * the system's keychain (the Keychain on a Mac, data protection on Windows) before it's written
 * to a file in the app's data folder, so the file alone opens nothing.
 */
export class Secrets {
  private readonly file: string;
  private readonly keychain: Keychain;

  constructor(file: string, keychain: Keychain) {
    this.file = file;
    this.keychain = keychain;
  }

  /** Whether sync has kept anything here, without asking the keychain. */
  exists(): boolean {
    return existsSync(this.file);
  }

  /** Whether the keychain can lock secrets here. Without it, sync stays off. */
  available(): boolean {
    return this.keychain.isEncryptionAvailable();
  }

  private read(): Partial<Record<SecretName, string>> {
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return typeof saved === 'object' && saved !== null ? saved : {};
    } catch {
      return {};
    }
  }

  private write(secrets: Partial<Record<SecretName, string>>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  }

  get(name: SecretName): string | null {
    const locked = this.read()[name];
    if (typeof locked !== 'string' || !this.available()) return null;
    try {
      return this.keychain.decryptString(Buffer.from(locked, 'base64'));
    } catch {
      return null;
    }
  }

  set(name: SecretName, value: string): void {
    if (!this.available()) throw new Error(NO_KEYCHAIN_MESSAGE);
    const locked = this.keychain.encryptString(value).toString('base64');
    this.write({ ...this.read(), [name]: locked });
  }

  delete(name: SecretName): void {
    const { [name]: _, ...rest } = this.read();
    this.write(rest);
  }

  /** Forgets every secret, as when sync is turned off on this computer. */
  clear(): void {
    rmSync(this.file, { force: true });
  }
}

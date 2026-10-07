import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SafeStorageLike } from '../secret-store';

/**
 * Stand-in for Electron's `safeStorage` in unit tests (main project runs in plain Node, where
 * `safeStorage` does not exist). It really encrypts (AES-256-GCM with a per-instance key), so a
 * test can grep the file for plaintext, and a second instance behaves like another machine or
 * profile whose key cannot decrypt the first one's data.
 */
export interface FakeSafeStorage extends SafeStorageLike {
  /** Flip to false to simulate an OS with no usable encryption. */
  available: boolean;
  encryptCalls: number;
  decryptCalls: number;
}

export interface FakeSafeStorageOptions {
  available?: boolean;
  /** 32 bytes; share it between instances to simulate the same machine across restarts. */
  key?: Buffer;
  /** Simulates Linux, where `getSelectedStorageBackend` exists (`basic_text` = no keyring). */
  linuxBackend?: 'basic_text' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' | 'unknown';
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Chromium's OSCrypt prefixes its ciphertext with a version tag; keep the same shape. */
const PREFIX = Buffer.from('v10');

export function createFakeSafeStorage(options: FakeSafeStorageOptions = {}): FakeSafeStorage {
  const key = options.key ?? randomBytes(32);

  const fake: FakeSafeStorage = {
    available: options.available ?? true,
    encryptCalls: 0,
    decryptCalls: 0,

    isEncryptionAvailable() {
      return fake.available;
    },

    encryptString(plainText) {
      fake.encryptCalls += 1;
      if (!fake.available) {
        throw new Error('Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.');
      }
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      return Buffer.concat([PREFIX, iv, cipher.getAuthTag(), body]);
    },

    decryptString(encrypted) {
      fake.decryptCalls += 1;
      if (!fake.available) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString. Decryption is not available.');
      }
      try {
        if (!encrypted.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error('bad prefix');
        const iv = encrypted.subarray(PREFIX.length, PREFIX.length + IV_BYTES);
        const tag = encrypted.subarray(PREFIX.length + IV_BYTES, PREFIX.length + IV_BYTES + TAG_BYTES);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const body = encrypted.subarray(PREFIX.length + IV_BYTES + TAG_BYTES);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      }
    },
  };

  if (options.linuxBackend) {
    const backend = options.linuxBackend;
    fake.getSelectedStorageBackend = () => backend;
  }
  return fake;
}

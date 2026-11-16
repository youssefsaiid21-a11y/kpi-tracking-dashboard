import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

let keyWarningLogged = false;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.TENANT_ENCRYPTION_KEY;
  if (!keyHex || keyHex === '0000000000000000000000000000000000000000000000000000000000000000') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'TENANT_ENCRYPTION_KEY must be set to a secure 64-char hex string in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    if (!keyWarningLogged) {
      console.warn(
        '[encryption] TENANT_ENCRYPTION_KEY is not set or is using the dev fallback. ' +
        'Do NOT use this in production!'
      );
      keyWarningLogged = true;
    }
    // Fallback key for development only (all zeros)
    return Buffer.alloc(32, 0);
  }
  if (keyHex.length !== 64) {
    throw new Error('TENANT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:ciphertext:authTag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine as iv:ciphertext:authTag then base64 encode the whole thing
  const combined = `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypts a base64-encoded string produced by encrypt().
 * Expects the decoded format: iv:ciphertext:authTag (each part base64-encoded)
 */
export function decrypt(ciphertext: string): string {
  // If the value doesn't look like our encrypted format (base64 that decodes
  // to iv:ciphertext:authTag), treat it as plaintext and return as-is.
  // This allows storing unencrypted values during development.
  try {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) {
      // Not in encrypted format — return plaintext as-is
      return ciphertext;
    }
    // Proceed with decryption
    return decryptInternal(ciphertext);
  } catch {
    // Any error during format check — treat as plaintext
    return ciphertext;
  }
}

function decryptInternal(ciphertext: string): string {
  const key = getEncryptionKey();
  const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
  const parts = decoded.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format: expected iv:ciphertext:authTag');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

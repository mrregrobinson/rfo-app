const crypto = require('node:crypto');

// Generic scrypt hash/verify — used for both one-time setup codes and real passwords.
function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(value), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(value, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(value), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// TOTP secrets are encrypted at rest (AES-256-GCM) so a database-only leak doesn't hand
// over live 2FA codes. The key is derived from SESSION_SECRET via scrypt rather than
// requiring a second secret to manage/deploy.
let cachedKey = null;
function encryptionKey() {
  if (cachedKey) return cachedKey;
  const base = process.env.SESSION_SECRET || 'dev-secret-change-me';
  cachedKey = crypto.scryptSync(base, 'totp-secret-encryption', 32);
  return cachedKey;
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

function decryptSecret(blob) {
  const [ivB64, tagB64, dataB64] = blob.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

module.exports = { hashSecret, verifySecret, encryptSecret, decryptSecret, requireAuth };

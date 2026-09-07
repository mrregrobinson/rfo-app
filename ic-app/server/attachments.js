// Disk storage for meeting attachments — server/migrations/026_meeting_attachments.js
// holds only the metadata (filename, content type, size); the actual bytes live here,
// under the same data/ directory as ic.db and its backups (see README's "Persistent
// disk" note — whatever host volume keeps ic.db across deploys keeps these too).
//
// The on-disk filename is always <attachmentId>.<safeExt> — never derived from the
// user-supplied original filename beyond its extension, so there's no path-traversal or
// weird-character surface to sanitize. The real filename is stored in the DB and used
// only for display / Content-Disposition, never as a path segment.
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'meeting-attachments');

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB — generous for scanned docs/statements, small enough to keep the host volume sane.

function safeExt(filename) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

function meetingDir(meetingId) {
  return path.join(ATTACHMENTS_DIR, meetingId);
}

function attachmentPath(meetingId, attachmentId, filename) {
  return path.join(meetingDir(meetingId), `${attachmentId}.${safeExt(filename)}`);
}

function saveAttachment(meetingId, attachmentId, filename, buffer) {
  const dir = meetingDir(meetingId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(attachmentPath(meetingId, attachmentId, filename), buffer);
}

function readAttachment(meetingId, attachmentId, filename) {
  return fs.readFileSync(attachmentPath(meetingId, attachmentId, filename));
}

// File cleanup is best-effort: on this dev host (Dropbox-synced folder on Windows) a
// delete can transiently fail with EPERM if Dropbox's sync process has the file briefly
// locked, same class of issue as the SQLite data-loss incident this app already worked
// around. The DB row is the source of truth and is always removed by the caller first —
// a leftover file with no matching row is harmless clutter, not a correctness problem,
// so a cleanup failure here must never fail the request that triggered it.
function deleteAttachmentFile(meetingId, attachmentId, filename) {
  const p = attachmentPath(meetingId, attachmentId, filename);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    console.error(`Failed to delete attachment file ${p}:`, err.message);
  }
}

// Removes every attachment file for a meeting (called when the meeting itself is
// deleted — the DB rows cascade via the FK, but files on disk don't clean up on their
// own). Same best-effort handling as deleteAttachmentFile above.
function deleteAllForMeeting(meetingId) {
  const dir = meetingDir(meetingId);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to delete attachment directory ${dir}:`, err.message);
  }
}

module.exports = { MAX_ATTACHMENT_BYTES, saveAttachment, readAttachment, deleteAttachmentFile, deleteAllForMeeting };

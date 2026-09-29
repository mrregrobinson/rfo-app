const fs = require('node:fs');

// Pushes a copy of the local database backup (server/backup.js) into the same Dropbox
// folder the weekly local script (scripts/backup-to-dropbox.ps1) writes to, so an admin
// can trigger an offsite sync from the app itself instead of only from that scheduled
// Windows task. Both mechanisms converge on one folder and one 13-file retention policy
// - whichever one runs, it lists the folder's actual contents and prunes down to
// KEEP_COUNT, so they never fight each other or double-count.

class DropboxNotConfiguredError extends Error {}

function apiToken() {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) throw new DropboxNotConfiguredError('DROPBOX_ACCESS_TOKEN is not set on the server');
  return token;
}

// Root-relative Dropbox path matching the family's existing local sync folder
// (C:\Users\...\Dropbox\Personal\Family Office\RFO Backup) - requires a "Full Dropbox"
// scoped app, not an app-folder-scoped one, since it's outside any app-specific folder.
const BACKUP_PATH = process.env.DROPBOX_BACKUP_PATH || '/Personal/Family Office/RFO Backup';
const KEEP_COUNT = 13;

async function dropboxRequest(url, options) {
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${apiToken()}`, ...(options.headers || {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Dropbox API error ${resp.status}${text ? ': ' + text.slice(0, 300) : ''}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  return resp;
}

async function listOffsiteBackups() {
  let resp;
  try {
    resp = await dropboxRequest('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: BACKUP_PATH }),
    });
  } catch (err) {
    // The folder not existing yet (first-ever sync) isn't an error - just an empty list.
    if (err.status === 409 && /not_found/.test(err.body || '')) return [];
    throw err;
  }
  const data = await resp.json();
  return data.entries
    .filter((e) => e['.tag'] === 'file' && e.name.endsWith('.db'))
    .map((e) => ({ name: e.name, sizeBytes: e.size, modifiedAt: e.server_modified }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

async function uploadBackupFile(localPath, filename) {
  const buffer = fs.readFileSync(localPath);
  await dropboxRequest('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: `${BACKUP_PATH}/${filename}`, mode: 'overwrite', mute: true }),
    },
    body: buffer,
  });
}

async function deleteOffsiteBackup(filename) {
  await dropboxRequest('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `${BACKUP_PATH}/${filename}` }),
  });
}

// Uploads the given local backup file if the Dropbox folder doesn't already have a file
// by that name, then prunes the folder (by actual current contents, not an assumption)
// down to the KEEP_COUNT most recent. Filenames are the same ISO-timestamp scheme used
// throughout (ic-YYYY-MM-DDTHH-MM-SS-mmmZ.db), so name sort is chronological.
async function syncOffsiteBackup(localPath, filename) {
  const before = await listOffsiteBackups();
  const alreadyThere = before.some((f) => f.name === filename);
  if (!alreadyThere) await uploadBackupFile(localPath, filename);

  const after = alreadyThere ? before : await listOffsiteBackups();
  const sorted = [...after].sort((a, b) => a.name.localeCompare(b.name));
  const excess = sorted.length - KEEP_COUNT;
  const pruned = [];
  for (let i = 0; i < excess; i++) {
    await deleteOffsiteBackup(sorted[i].name);
    pruned.push(sorted[i].name);
  }
  return { filename, uploaded: !alreadyThere, pruned };
}

module.exports = { listOffsiteBackups, syncOffsiteBackup, DropboxNotConfiguredError };

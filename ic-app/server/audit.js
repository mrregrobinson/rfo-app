const db = require('./db');

// Records who did what, when, to what — the governance record for actions that matter
// (opportunity lifecycle, submissions, reports, auth/account changes). Never throws:
// a logging failure should never break the request that triggered it.
function logAudit({ userId, action, entityType, entityId, details }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (at, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(new Date().toISOString(), userId || null, action, entityType || null, entityId || null, JSON.stringify(details || {}));
  } catch (err) {
    console.error('Failed to write audit log entry:', err.message);
  }
}

function auditRowToJson(row) {
  return {
    id: row.id,
    at: row.at,
    userId: row.user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: JSON.parse(row.details || '{}'),
  };
}

module.exports = { logAudit, auditRowToJson };

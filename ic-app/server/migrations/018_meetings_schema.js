// Family Office Meetings module — see RFO_Meetings_App_BuildSpec_v1.docx, Section 5.
// Family action items create a real row in the existing tasks table (server/tasks.js);
// per the family's confirmed answer on category placement (Section 5.6), a meeting
// action item is filed under whichever existing task_categories row the person
// recording minutes picks — no new category is seeded here.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      planned_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'planned',
      invite_send_date TEXT,
      invite_sent_at TEXT,
      graph_event_id TEXT,
      teams_join_url TEXT,
      completed_by TEXT REFERENCES users(id),
      completed_at TEXT,
      minutes_emailed_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_attendees (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      external_name TEXT,
      external_email TEXT
    );

    CREATE TABLE IF NOT EXISTS agenda_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      discussion_summary TEXT NOT NULL DEFAULT '',
      added_during_minutes INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_decisions (
      id TEXT PRIMARY KEY,
      agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_action_items (
      id TEXT PRIMARY KEY,
      agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      is_family INTEGER NOT NULL,
      assignee_user_id TEXT REFERENCES users(id),
      assignee_name TEXT,
      task_id TEXT REFERENCES tasks(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
  `);
};

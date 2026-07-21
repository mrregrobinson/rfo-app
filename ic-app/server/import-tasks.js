// One-off import of Family_Office_Task_List_2026 Q2.xlsx into the tasks/task_assignees
// tables, from the transcription in task-import-data.js. Run manually once:
//   node server/import-tasks.js
// Safe to re-run — skips categories that already have imported tasks, so it won't
// duplicate rows if run again after someone has started adding their own tasks.
const crypto = require('node:crypto');
const db = require('./db');
const data = require('./task-import-data');

const ASSIGNEE_CODE_TO_USER_ID = { RLR: 'reg', SDR: 'sd', RWR: 'ross', LJR: 'lucas' };

const PRIORITY_MAP = { H: 'high', M: 'medium', L: 'low' };

// Excel's day-0 is 1899-12-30 (not 1900-01-01, due to a long-standing Lotus 1-2-3 bug
// Excel preserved for compatibility).
function excelSerialToDate(serial) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function quarterOf(date) {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${q}`;
}

// Resolves a task's `target` field into { targetDate, targetQuarter, sourceRefFromTarget }.
// See task-import-data.js's header comment for what each shape means.
function resolveTarget(target) {
  if (!target) return { targetDate: null, targetQuarter: null, sourceRefFromTarget: null };
  if (target.quarter) return { targetDate: null, targetQuarter: target.quarter, sourceRefFromTarget: null };
  if (target.serial) {
    const date = excelSerialToDate(target.serial);
    return { targetDate: date.toISOString().slice(0, 10), targetQuarter: quarterOf(date), sourceRefFromTarget: null };
  }
  if (target.ref) return { targetDate: null, targetQuarter: null, sourceRefFromTarget: target.ref };
  return { targetDate: null, targetQuarter: null, sourceRefFromTarget: null };
}

function insertTask({ categoryId, parentTaskId, task, adminUserId, now }) {
  const id = crypto.randomUUID();
  const { targetDate, targetQuarter, sourceRefFromTarget } = resolveTarget(task.target);
  const sourceRef = task.sourceRef != null ? task.sourceRef : sourceRefFromTarget;
  db.prepare(
    `INSERT INTO tasks (id, category_id, parent_task_id, title, priority, target_quarter, target_date, status, completed_at, notes, source_ref_id, created_by, created_at, updated_at)
     VALUES (@id, @categoryId, @parentTaskId, @title, @priority, @targetQuarter, @targetDate, 'open', NULL, @notes, @sourceRef, @createdBy, @createdAt, @updatedAt)`
  ).run({
    id,
    categoryId,
    parentTaskId: parentTaskId || null,
    title: task.title,
    priority: PRIORITY_MAP[task.priority] || 'medium',
    targetQuarter,
    targetDate,
    notes: task.notes || '',
    sourceRef: sourceRef != null ? sourceRef : null,
    createdBy: adminUserId,
    createdAt: now,
    updatedAt: now,
  });

  for (const code of task.assignees || []) {
    if (code === 'ALL') {
      db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, NULL)').run(id);
    } else {
      const userId = ASSIGNEE_CODE_TO_USER_ID[code];
      if (userId) db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(id, userId);
    }
  }

  for (const child of task.children || []) {
    insertTask({ categoryId, parentTaskId: id, task: child, adminUserId, now });
  }
}

function run() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  if (existing > 0) {
    console.log(`tasks table already has ${existing} row(s) — skipping import to avoid duplicates.`);
    return;
  }
  const admin = db.prepare("SELECT id FROM users WHERE is_fo_admin = 1 ORDER BY id LIMIT 1").get();
  const adminUserId = admin ? admin.id : db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const now = new Date().toISOString();
  let count = 0;
  for (const block of data) {
    const category = db.prepare('SELECT id FROM task_categories WHERE id = ?').get(block.category);
    if (!category) {
      console.warn(`Unknown category "${block.category}" — skipping its tasks.`);
      continue;
    }
    for (const task of block.tasks) {
      insertTask({ categoryId: category.id, parentTaskId: null, task, adminUserId, now });
      count += 1 + (task.children || []).length;
    }
  }
  console.log(`Imported ${count} tasks from Family_Office_Task_List_2026 Q2.xlsx.`);
}

run();

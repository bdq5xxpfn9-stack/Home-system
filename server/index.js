import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import cron from 'node-cron';
import webpush from 'web-push';
import { db, nowISO } from './db.js';
import {
  nextDueDate,
  nextDueDateWithRule,
  parseRecurrenceRule,
  randomColor,
  todayISO,
  PASTEL_COLORS
} from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const rawSubject = process.env.VAPID_SUBJECT || 'mailto:family@example.com';
const VAPID_SUBJECT =
  rawSubject.startsWith('mailto:') || rawSubject.startsWith('http')
    ? rawSubject
    : `mailto:${rawSubject}`;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function getHousehold(id) {
  return db.prepare('SELECT * FROM households WHERE id = ?').get(id);
}

function getMember(id) {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function getHouseholdMembers(householdId) {
  return db.prepare('SELECT * FROM members WHERE household_id = ?').all(householdId);
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function pickMemberColor(householdId, seed = '') {
  const used = db
    .prepare('SELECT color FROM members WHERE household_id = ?')
    .all(householdId)
    .map((row) => row.color)
    .filter(Boolean);
  const usedSet = new Set(used);
  const available = PASTEL_COLORS.filter((color) => !usedSet.has(color));
  if (available.length > 0) {
    return available[0];
  }
  return randomColor(seed);
}

function clearHouseholdData(householdId) {
  db.prepare(
    'DELETE FROM task_completions WHERE task_id IN (SELECT id FROM tasks WHERE household_id = ?)'
  ).run(householdId);
  db.prepare('DELETE FROM tasks WHERE household_id = ?').run(householdId);
  db.prepare(
    'DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE household_id = ?)'
  ).run(householdId);
  db.prepare('DELETE FROM lists WHERE household_id = ?').run(householdId);
  db.prepare(
    'DELETE FROM push_subscriptions WHERE member_id IN (SELECT id FROM members WHERE household_id = ?)'
  ).run(householdId);
  db.prepare('DELETE FROM members WHERE household_id = ?').run(householdId);
}

app.get('/api/health', (req, res) => {
  sendJson(res, 200, { status: 'ok' });
});

app.get('/api/push/public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return sendJson(res, 200, { publicKey: null });
  }
  return sendJson(res, 200, { publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/households/join', (req, res) => {
  const { accessCode, householdName, timezone, locale, memberName } = req.body || {};

  if (!accessCode || !memberName) {
    return sendJson(res, 400, { error: 'Access code and member name are required.' });
  }

  let household = db.prepare('SELECT * FROM households WHERE access_code = ?').get(accessCode);

  if (!household) {
    if (!householdName) {
      return sendJson(res, 400, { error: 'Household name required for new household.' });
    }

    const createdAt = nowISO();
    const info = db
      .prepare(
        'INSERT INTO households (name, access_code, timezone, locale, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(householdName, accessCode, timezone || 'Europe/Zurich', locale || 'de-CH', createdAt);
    household = getHousehold(info.lastInsertRowid);
  }

  const existingMember = db
    .prepare('SELECT * FROM members WHERE household_id = ? AND lower(name) = lower(?)')
    .get(household.id, memberName);

  let member = existingMember;
  if (!member) {
    const createdAt = nowISO();
    const color = pickMemberColor(household.id, memberName);
    const memberInfo = db
      .prepare(
        'INSERT INTO members (household_id, name, color, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(household.id, memberName, color, createdAt);
    member = getMember(memberInfo.lastInsertRowid);
  }

  return sendJson(res, 200, { household, member });
});

app.get('/api/admin/export', (req, res) => {
  const { accessCode } = req.query || {};
  if (!accessCode) {
    return sendJson(res, 400, { error: 'Access code required.' });
  }

  const household = db.prepare('SELECT * FROM households WHERE access_code = ?').get(accessCode);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const members = db
    .prepare('SELECT * FROM members WHERE household_id = ? ORDER BY id ASC')
    .all(household.id);
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE household_id = ? ORDER BY id ASC')
    .all(household.id);
  const completions = db
    .prepare(
      'SELECT tc.* FROM task_completions tc INNER JOIN tasks t ON t.id = tc.task_id WHERE t.household_id = ?'
    )
    .all(household.id);
  const lists = db
    .prepare('SELECT * FROM lists WHERE household_id = ? ORDER BY id ASC')
    .all(household.id);
  const listItems = db
    .prepare(
      'SELECT li.* FROM list_items li INNER JOIN lists l ON l.id = li.list_id WHERE l.household_id = ?'
    )
    .all(household.id);

  return sendJson(res, 200, {
    version: 1,
    exportedAt: nowISO(),
    household: {
      name: household.name,
      access_code: household.access_code,
      timezone: household.timezone,
      locale: household.locale
    },
    members,
    tasks,
    task_completions: completions,
    lists,
    list_items: listItems
  });
});

app.post('/api/admin/import', (req, res) => {
  const { accessCode, mode, data } = req.body || {};
  if (!accessCode || !data) {
    return sendJson(res, 400, { error: 'Access code and data required.' });
  }

  const importMode = mode === 'merge' ? 'merge' : 'replace';
  const payload = data.household ? data : { household: {}, ...data };

  let household = db.prepare('SELECT * FROM households WHERE access_code = ?').get(accessCode);
  if (!household) {
    const createdAt = nowISO();
    const info = db
      .prepare(
        'INSERT INTO households (name, access_code, timezone, locale, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        payload.household?.name || 'Haushalt',
        accessCode,
        payload.household?.timezone || 'Europe/Zurich',
        payload.household?.locale || 'de-CH',
        createdAt
      );
    household = getHousehold(info.lastInsertRowid);
  }

  if (importMode === 'replace') {
    clearHouseholdData(household.id);
    db.prepare('UPDATE households SET name = ?, timezone = ?, locale = ? WHERE id = ?').run(
      payload.household?.name || household.name,
      payload.household?.timezone || household.timezone,
      payload.household?.locale || household.locale,
      household.id
    );
  }

  const memberIdMap = new Map();
  const existingMembers = db
    .prepare('SELECT * FROM members WHERE household_id = ?')
    .all(household.id);
  const existingByName = new Map(
    existingMembers.map((member) => [member.name.toLowerCase(), member])
  );

  for (const member of payload.members || []) {
    const existing = existingByName.get(String(member.name || '').toLowerCase());
    if (existing) {
      memberIdMap.set(member.id, existing.id);
      continue;
    }
    const createdAt = member.created_at || nowISO();
    const info = db
      .prepare('INSERT INTO members (household_id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(
        household.id,
        member.name,
        member.color || pickMemberColor(household.id, member.name),
        createdAt
      );
    memberIdMap.set(member.id, info.lastInsertRowid);
  }

  const taskIdMap = new Map();
  for (const task of payload.tasks || []) {
    const info = db
      .prepare(
        `INSERT INTO tasks
          (household_id, title, notes, recurrence, due_date, primary_member_id, secondary_member_id, recurrence_rule, transferred_from_member_id, transferred_at, created_at, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        household.id,
        task.title,
        task.notes || null,
        task.recurrence,
        task.due_date,
        memberIdMap.get(task.primary_member_id) || null,
        memberIdMap.get(task.secondary_member_id) || null,
        task.recurrence_rule || null,
        memberIdMap.get(task.transferred_from_member_id) || null,
        task.transferred_at || null,
        task.created_at || nowISO(),
        typeof task.active === 'number' ? task.active : 1
      );
    taskIdMap.set(task.id, info.lastInsertRowid);
  }

  for (const completion of payload.task_completions || []) {
    const mappedTaskId = taskIdMap.get(completion.task_id);
    if (!mappedTaskId) continue;
    db.prepare(
      'INSERT INTO task_completions (task_id, completed_at, completed_by_member_id) VALUES (?, ?, ?)'
    ).run(
      mappedTaskId,
      completion.completed_at,
      memberIdMap.get(completion.completed_by_member_id) || null
    );
  }

  const listIdMap = new Map();
  for (const list of payload.lists || []) {
    const info = db
      .prepare('INSERT INTO lists (household_id, title, type, created_at) VALUES (?, ?, ?, ?)')
      .run(household.id, list.title, list.type || null, list.created_at || nowISO());
    listIdMap.set(list.id, info.lastInsertRowid);
  }

  for (const item of payload.list_items || []) {
    const mappedListId = listIdMap.get(item.list_id);
    if (!mappedListId) continue;
    db.prepare(
      'INSERT INTO list_items (list_id, text, done, created_at, done_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      mappedListId,
      item.text,
      typeof item.done === 'number' ? item.done : 0,
      item.created_at || nowISO(),
      item.done_at || null
    );
  }

  return sendJson(res, 200, { ok: true });
});

app.get('/api/households/:id/members', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const members = db
    .prepare('SELECT * FROM members WHERE household_id = ? ORDER BY name ASC')
    .all(household.id);
  return sendJson(res, 200, { members });
});

app.post('/api/households/:id/members', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const { name } = req.body || {};
  if (!name) {
    return sendJson(res, 400, { error: 'Name is required.' });
  }

  const existingMember = db
    .prepare('SELECT * FROM members WHERE household_id = ? AND lower(name) = lower(?)')
    .get(household.id, name);
  if (existingMember) {
    return sendJson(res, 200, { member: existingMember, reused: true });
  }

  const createdAt = nowISO();
  const color = pickMemberColor(household.id, name);
  const info = db
    .prepare('INSERT INTO members (household_id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(household.id, name, color, createdAt);
  const member = getMember(info.lastInsertRowid);
  return sendJson(res, 200, { member });
});

app.post('/api/households/:id/reset-colors', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const members = db
    .prepare('SELECT * FROM members WHERE household_id = ? ORDER BY name ASC')
    .all(household.id);

  members.forEach((member, index) => {
    const color = PASTEL_COLORS[index % PASTEL_COLORS.length];
    db.prepare('UPDATE members SET color = ? WHERE id = ?').run(color, member.id);
  });

  const updated = db
    .prepare('SELECT * FROM members WHERE household_id = ? ORDER BY name ASC')
    .all(household.id);
  return sendJson(res, 200, { members: updated });
});

app.delete('/api/members/:id', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) {
    return sendJson(res, 404, { error: 'Member not found.' });
  }

  db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
  db.prepare('DELETE FROM push_subscriptions WHERE member_id = ?').run(member.id);
  db.prepare('UPDATE tasks SET primary_member_id = NULL WHERE primary_member_id = ?').run(member.id);
  db.prepare('UPDATE tasks SET secondary_member_id = NULL WHERE secondary_member_id = ?').run(member.id);

  return sendJson(res, 200, { ok: true });
});

app.get('/api/households/:id/tasks', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const tasks = db
    .prepare('SELECT * FROM tasks WHERE household_id = ? AND active = 1 ORDER BY due_date ASC')
    .all(household.id);
  return sendJson(res, 200, { tasks });
});

app.post('/api/households/:id/tasks', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const {
    title,
    notes,
    recurrence,
    dueDate,
    primaryMemberId,
    secondaryMemberId,
    recurrenceRule
  } = req.body || {};
  if (!title || !recurrence || !dueDate) {
    return sendJson(res, 400, { error: 'Title, recurrence, and due date are required.' });
  }

  const createdAt = nowISO();
  const storedRule =
    recurrenceRule && typeof recurrenceRule !== 'string'
      ? JSON.stringify(recurrenceRule)
      : recurrenceRule || null;

  const info = db
    .prepare(
      `INSERT INTO tasks
        (household_id, title, notes, recurrence, due_date, primary_member_id, secondary_member_id, recurrence_rule, transferred_from_member_id, transferred_at, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1)`
    )
    .run(
      household.id,
      title,
      notes || null,
      recurrence,
      dueDate,
      primaryMemberId || null,
      secondaryMemberId || null,
      storedRule,
      createdAt
    );

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  return sendJson(res, 200, { task });
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  const storedRule =
    req.body.recurrenceRule === null
      ? null
      : req.body.recurrenceRule && typeof req.body.recurrenceRule !== 'string'
        ? JSON.stringify(req.body.recurrenceRule)
        : req.body.recurrenceRule ?? task.recurrence_rule;

  const updates = {
    title: req.body.title ?? task.title,
    notes: req.body.notes ?? task.notes,
    recurrence: req.body.recurrence ?? task.recurrence,
    due_date: req.body.dueDate ?? task.due_date,
    primary_member_id: req.body.primaryMemberId ?? task.primary_member_id,
    secondary_member_id: req.body.secondaryMemberId ?? task.secondary_member_id,
    recurrence_rule: storedRule,
    active: typeof req.body.active === 'number' ? req.body.active : task.active
  };

  db.prepare(
    `UPDATE tasks
     SET title = ?, notes = ?, recurrence = ?, due_date = ?, primary_member_id = ?, secondary_member_id = ?, recurrence_rule = ?, active = ?
     WHERE id = ?`
  ).run(
    updates.title,
    updates.notes,
    updates.recurrence,
    updates.due_date,
    updates.primary_member_id,
    updates.secondary_member_id,
    updates.recurrence_rule,
    updates.active,
    task.id
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  return sendJson(res, 200, { task: updated });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  const household = getHousehold(task.household_id);
  const timezone = household?.timezone || 'Europe/Zurich';

  const completedAt = req.body.completedAt || todayISO(timezone);
  const completedByMemberId = req.body.completedByMemberId || null;

  db.prepare(
    'INSERT INTO task_completions (task_id, completed_at, completed_by_member_id) VALUES (?, ?, ?)'
  ).run(task.id, completedAt, completedByMemberId);

  if (task.recurrence === 'once') {
    db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(task.id);
  } else {
    const rule = parseRecurrenceRule(task.recurrence_rule);
    const nextDate = rule
      ? nextDueDateWithRule(task.due_date, task.recurrence, rule, timezone, completedAt)
      : nextDueDate(task.due_date, task.recurrence, timezone, completedAt);
    db.prepare(
      'UPDATE tasks SET due_date = ?, transferred_from_member_id = NULL, transferred_at = NULL WHERE id = ?'
    ).run(nextDate, task.id);
  }

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  return sendJson(res, 200, { task: updated });
});

app.post('/api/tasks/:id/transfer', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  const { toMemberId, fromMemberId } = req.body || {};

  let newPrimary = task.primary_member_id;
  let newSecondary = task.secondary_member_id;

  if (toMemberId) {
    newSecondary = task.primary_member_id || null;
    newPrimary = toMemberId;
  } else if (task.secondary_member_id) {
    newPrimary = task.secondary_member_id;
    newSecondary = task.primary_member_id || null;
  } else {
    return sendJson(res, 400, { error: 'No secondary member to transfer to.' });
  }

  const transferredFrom = task.primary_member_id || null;
  db.prepare(
    'UPDATE tasks SET primary_member_id = ?, secondary_member_id = ?, transferred_from_member_id = ?, transferred_at = ? WHERE id = ?'
  ).run(newPrimary, newSecondary, transferredFrom, nowISO(), task.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);

  let pushResult = { sent: 0, failed: 0, configured: false, errors: [] };
  const fromMember = fromMemberId ? getMember(fromMemberId) : null;
  const senderName = fromMember ? fromMember.name : 'Jemand';
  const newPrimaryMember = newPrimary ? getMember(newPrimary) : null;
  const recipientName = newPrimaryMember ? newPrimaryMember.name : 'jemanden';
  const householdMembers = getHouseholdMembers(task.household_id);
  if (householdMembers.length) {
    pushResult = await sendPushToMembers(
      householdMembers.map((member) => member.id),
      {
        title: 'Aufgabe übertragen',
        body: `${senderName} hat die Aufgabe „${updated.title}“ an ${recipientName} übertragen.`,
        data: { type: 'transfer', taskId: updated.id }
      },
      fromMemberId || null
    );
  }

  return sendJson(res, 200, { task: updated, push: pushResult });
});

app.post('/api/tasks/:id/nudge', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  const { fromMemberId } = req.body || {};
  const fromMember = fromMemberId ? getMember(fromMemberId) : null;
  const senderName = fromMember ? fromMember.name : 'Jemand';

  const householdMembers = getHouseholdMembers(task.household_id);
  const targets = [task.primary_member_id, task.secondary_member_id].filter(
    (id) => id && id !== fromMemberId
  );
  const targetNames = householdMembers
    .filter((member) => targets.includes(member.id))
    .map((member) => member.name)
    .join(' & ');
  const body = targetNames
    ? `${senderName} hat ${targetNames} an „${task.title}“ erinnert.`
    : `${senderName} hat an „${task.title}“ erinnert.`;

  const result = await sendPushToMembers(
    householdMembers.map((member) => member.id),
    {
      title: 'Erinnerung',
      body,
      data: { type: 'nudge', taskId: task.id }
    },
    fromMemberId || null
  );

  return sendJson(res, 200, result);
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  db.prepare('DELETE FROM task_completions WHERE task_id = ?').run(task.id);
  return sendJson(res, 200, { ok: true });
});

app.get('/api/households/:id/lists', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const lists = db
    .prepare('SELECT * FROM lists WHERE household_id = ? ORDER BY created_at ASC')
    .all(household.id);
  const items = db
    .prepare(
      'SELECT li.* FROM list_items li INNER JOIN lists l ON l.id = li.list_id WHERE l.household_id = ?'
    )
    .all(household.id);

  const itemsByList = items.reduce((acc, item) => {
    acc[item.list_id] = acc[item.list_id] || [];
    acc[item.list_id].push(item);
    return acc;
  }, {});

  const payload = lists.map((list) => ({
    ...list,
    items: itemsByList[list.id] || []
  }));

  return sendJson(res, 200, { lists: payload });
});

app.post('/api/households/:id/lists', (req, res) => {
  const household = getHousehold(req.params.id);
  if (!household) {
    return sendJson(res, 404, { error: 'Household not found.' });
  }

  const { title, type } = req.body || {};
  if (!title) {
    return sendJson(res, 400, { error: 'Title is required.' });
  }

  const createdAt = nowISO();
  const info = db
    .prepare('INSERT INTO lists (household_id, title, type, created_at) VALUES (?, ?, ?, ?)')
    .run(household.id, title, type || null, createdAt);

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(info.lastInsertRowid);
  return sendJson(res, 200, { list: { ...list, items: [] } });
});

app.post('/api/lists/:id/items', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) {
    return sendJson(res, 404, { error: 'List not found.' });
  }

  const { text } = req.body || {};
  if (!text) {
    return sendJson(res, 400, { error: 'Text is required.' });
  }

  const createdAt = nowISO();
  const info = db
    .prepare('INSERT INTO list_items (list_id, text, created_at) VALUES (?, ?, ?)')
    .run(list.id, text, createdAt);

  const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(info.lastInsertRowid);
  return sendJson(res, 200, { item });
});

app.patch('/api/list-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return sendJson(res, 404, { error: 'Item not found.' });
  }

  const done = typeof req.body.done === 'number' ? req.body.done : item.done;
  const text = req.body.text ?? item.text;
  const doneAt = done ? nowISO() : null;

  db.prepare('UPDATE list_items SET text = ?, done = ?, done_at = ? WHERE id = ?').run(
    text,
    done,
    doneAt,
    item.id
  );

  const updated = db.prepare('SELECT * FROM list_items WHERE id = ?').get(item.id);
  return sendJson(res, 200, { item: updated });
});

app.delete('/api/list-items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM list_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return sendJson(res, 404, { error: 'Item not found.' });
  }

  db.prepare('DELETE FROM list_items WHERE id = ?').run(item.id);
  return sendJson(res, 200, { ok: true });
});

app.delete('/api/lists/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) {
    return sendJson(res, 404, { error: 'List not found.' });
  }

  db.prepare('DELETE FROM list_items WHERE list_id = ?').run(list.id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(list.id);
  return sendJson(res, 200, { ok: true });
});

app.post('/api/members/:id/push-subscription', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) {
    return sendJson(res, 404, { error: 'Member not found.' });
  }

  const { subscription } = req.body || {};
  if (!subscription) {
    return sendJson(res, 400, { error: 'Subscription is required.' });
  }

  const createdAt = nowISO();
  db.prepare('DELETE FROM push_subscriptions WHERE member_id = ?').run(member.id);
  db.prepare(
    'INSERT INTO push_subscriptions (member_id, subscription_json, created_at) VALUES (?, ?, ?)'
  ).run(member.id, JSON.stringify(subscription), createdAt);

  return sendJson(res, 200, { ok: true });
});

app.get('/api/members/:id/push-status', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) {
    return sendJson(res, 404, { error: 'Member not found.' });
  }

  const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  const count = db
    .prepare('SELECT COUNT(*) as count FROM push_subscriptions WHERE member_id = ?')
    .get(member.id).count;

  return sendJson(res, 200, { configured, subscriptions: count });
});

app.post('/api/members/:id/push-test', async (req, res) => {
  const member = getMember(req.params.id);
  if (!member) {
    return sendJson(res, 404, { error: 'Member not found.' });
  }

  const result = await sendPushToMember(member.id, {
    title: 'Familienplan',
    body: 'Push-Benachrichtigungen sind aktiv.'
  });

  const count = db
    .prepare('SELECT COUNT(*) as count FROM push_subscriptions WHERE member_id = ?')
    .get(member.id).count;
  return sendJson(res, 200, { ...result, subscriptions: count });
});

async function sendPushToMember(memberId, payload) {
  const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (!configured) {
    return { sent: 0, failed: 0, configured: false };
  }

  const subs = db
    .prepare('SELECT * FROM push_subscriptions WHERE member_id = ? ORDER BY id ASC')
    .all(memberId);

  let sent = 0;
  let failed = 0;
  const errors = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription_json), JSON.stringify(payload));
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        failed += 1;
        const statusCode = err?.statusCode || null;
        const message = err?.body || err?.message || 'Push error';
        errors.push({ statusCode, message });
        console.error('Push send failed', statusCode || '', message);
      }
    }
  }

  return { sent, failed, configured: true, errors };
}

async function sendPushToMembers(memberIds, payload, excludeMemberId = null) {
  const uniqueIds = Array.from(new Set((memberIds || []).filter(Boolean))).filter(
    (id) => id !== excludeMemberId
  );

  let sent = 0;
  let failed = 0;
  let configured = false;
  const errors = [];

  for (const memberId of uniqueIds) {
    const result = await sendPushToMember(memberId, payload);
    sent += result.sent || 0;
    failed += result.failed || 0;
    configured = configured || result.configured;
    if (result.errors?.length) {
      errors.push(...result.errors);
    }
  }

  return { sent, failed, configured, errors };
}

async function sendDailyReminders() {
  const households = db.prepare('SELECT * FROM households').all();

  for (const household of households) {
    const tz = household.timezone || 'Europe/Zurich';
    const today = DateTime.now().setZone(tz).toISODate();

    const members = db
      .prepare('SELECT * FROM members WHERE household_id = ?')
      .all(household.id);

    const tasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE household_id = ?
           AND active = 1
           AND due_date <= ?`
      )
      .all(household.id, today);

    if (!tasks.length) {
      continue;
    }

    for (const member of members) {
      if (member.last_daily_push_date === today) {
        continue;
      }

      const memberTasks = tasks.filter(
        (task) => task.primary_member_id === member.id || task.secondary_member_id === member.id
      );

      if (!memberTasks.length) {
        continue;
      }

      const body =
        memberTasks.length === 1
          ? `Guten Morgen ${member.name}, schau dir deine Aufgabe für heute an: ${memberTasks[0].title}`
          : `Guten Morgen ${member.name}, schau dir an, was heute ansteht. Du hast ${memberTasks.length} Aufgaben.`;

      await sendPushToMember(member.id, {
        title: 'Familienplan – Heute',
        body,
        data: { type: 'daily', date: today }
      });

      db.prepare('UPDATE members SET last_daily_push_date = ? WHERE id = ?').run(today, member.id);
    }
  }
}

async function sendEveningReminders() {
  const households = db.prepare('SELECT * FROM households').all();

  for (const household of households) {
    const tz = household.timezone || 'Europe/Zurich';
    const today = DateTime.now().setZone(tz).toISODate();

    const members = db
      .prepare('SELECT * FROM members WHERE household_id = ?')
      .all(household.id);

    const tasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE household_id = ?
           AND active = 1
           AND due_date <= ?`
      )
      .all(household.id, today);

    if (!tasks.length) {
      continue;
    }

    for (const member of members) {
      if (member.last_evening_push_date === today) {
        continue;
      }

      const memberTasks = tasks.filter(
        (task) => task.primary_member_id === member.id
      );

      if (!memberTasks.length) {
        continue;
      }

      const body =
        memberTasks.length === 1
          ? `Hey ${member.name}, ist die Aufgabe „${memberTasks[0].title}“ bis 21:00 erledigt?`
          : `Hey ${member.name}, hast du deine Aufgaben für heute erledigt? Du hast noch ${memberTasks.length} offene.`;

      await sendPushToMember(member.id, {
        title: 'Familienplan – 20:00 Erinnerung',
        body,
        data: { type: 'evening', date: today }
      });

      db.prepare('UPDATE members SET last_evening_push_date = ? WHERE id = ?').run(today, member.id);
    }
  }
}

async function sendPenaltyReminders() {
  const households = db.prepare('SELECT * FROM households').all();

  for (const household of households) {
    const tz = household.timezone || 'Europe/Zurich';
    const today = DateTime.now().setZone(tz).toISODate();

    const tasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE household_id = ?
           AND active = 1
           AND due_date <= ?`
      )
      .all(household.id, today);

    if (!tasks.length) {
      continue;
    }

    for (const task of tasks) {
      if (!task.primary_member_id) {
        continue;
      }
      if (task.last_penalty_date === today) {
        continue;
      }

      const primary = getMember(task.primary_member_id);
      if (!primary) {
        continue;
      }

      const secondary = task.secondary_member_id ? getMember(task.secondary_member_id) : null;
      const penaltyTarget = secondary ? ` an ${secondary.name}` : '';
      const body = `Aufgabe „${task.title}“ ist nicht erledigt. Du schuldest deine Strafe${penaltyTarget}.`;

      await sendPushToMember(primary.id, {
        title: 'Familienplan – 21:00 Strafe',
        body,
        data: { type: 'penalty', taskId: task.id, date: today }
      });

      db.prepare('UPDATE tasks SET last_penalty_date = ? WHERE id = ?').run(today, task.id);
    }
  }
}

cron.schedule('0 7 * * *', () => {
  sendDailyReminders();
}, { timezone: 'Europe/Zurich' });

cron.schedule('0 20 * * *', () => {
  sendEveningReminders();
}, { timezone: 'Europe/Zurich' });

cron.schedule('0 21 * * *', () => {
  sendPenaltyReminders();
}, { timezone: 'Europe/Zurich' });

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => {
  console.log(`Family system server running on port ${PORT}`);
});

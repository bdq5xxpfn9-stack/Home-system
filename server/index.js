import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import cron from 'node-cron';
import webpush from 'web-push';
import { db, nowISO } from './db.js';
import { nextDueDate, randomColor, todayISO, PASTEL_COLORS } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:family@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function getHousehold(id) {
  return db.prepare('SELECT * FROM households WHERE id = ?').get(id);
}

function getMember(id) {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
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

  const { title, notes, recurrence, dueDate, primaryMemberId, secondaryMemberId } = req.body || {};
  if (!title || !recurrence || !dueDate) {
    return sendJson(res, 400, { error: 'Title, recurrence, and due date are required.' });
  }

  const createdAt = nowISO();
  const info = db
    .prepare(
      `INSERT INTO tasks
        (household_id, title, notes, recurrence, due_date, primary_member_id, secondary_member_id, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      household.id,
      title,
      notes || null,
      recurrence,
      dueDate,
      primaryMemberId || null,
      secondaryMemberId || null,
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

  const updates = {
    title: req.body.title ?? task.title,
    notes: req.body.notes ?? task.notes,
    recurrence: req.body.recurrence ?? task.recurrence,
    due_date: req.body.dueDate ?? task.due_date,
    primary_member_id: req.body.primaryMemberId ?? task.primary_member_id,
    secondary_member_id: req.body.secondaryMemberId ?? task.secondary_member_id,
    active: typeof req.body.active === 'number' ? req.body.active : task.active
  };

  db.prepare(
    `UPDATE tasks
     SET title = ?, notes = ?, recurrence = ?, due_date = ?, primary_member_id = ?, secondary_member_id = ?, active = ?
     WHERE id = ?`
  ).run(
    updates.title,
    updates.notes,
    updates.recurrence,
    updates.due_date,
    updates.primary_member_id,
    updates.secondary_member_id,
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
    const nextDate = nextDueDate(completedAt, task.recurrence, timezone);
    db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(nextDate, task.id);
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

  db.prepare(
    'UPDATE tasks SET primary_member_id = ?, secondary_member_id = ? WHERE id = ?'
  ).run(newPrimary, newSecondary, task.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);

  if (newPrimary && newPrimary !== fromMemberId) {
    const fromMember = fromMemberId ? getMember(fromMemberId) : null;
    const senderName = fromMember ? fromMember.name : 'Jemand';
    await sendPushToMember(newPrimary, {
      title: 'Aufgabe übertragen',
      body: `${senderName} hat dir die Aufgabe „${updated.title}“ übertragen.`
    });
  }

  return sendJson(res, 200, { task: updated });
});

app.post('/api/tasks/:id/nudge', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return sendJson(res, 404, { error: 'Task not found.' });
  }

  const { fromMemberId } = req.body || {};
  const fromMember = fromMemberId ? getMember(fromMemberId) : null;
  const senderName = fromMember ? fromMember.name : 'Jemand';

  const targets = [task.primary_member_id, task.secondary_member_id].filter(
    (id) => id && id !== fromMemberId
  );

  let sent = 0;
  for (const targetId of targets) {
    sent += await sendPushToMember(targetId, {
      title: 'Erinnerung',
      body: `${senderName} erinnert dich an: ${task.title}`
    });
  }

  return sendJson(res, 200, { sent });
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
  db.prepare('INSERT INTO push_subscriptions (member_id, subscription_json, created_at) VALUES (?, ?, ?)').run(
    member.id,
    JSON.stringify(subscription),
    createdAt
  );

  return sendJson(res, 200, { ok: true });
});

app.post('/api/members/:id/push-test', async (req, res) => {
  const member = getMember(req.params.id);
  if (!member) {
    return sendJson(res, 404, { error: 'Member not found.' });
  }

  const sent = await sendPushToMember(member.id, {
    title: 'Familienplan',
    body: 'Push-Benachrichtigungen sind aktiv.'
  });

  return sendJson(res, 200, { sent });
});

async function sendPushToMember(memberId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return 0;
  }

  const subs = db
    .prepare('SELECT * FROM push_subscriptions WHERE member_id = ? ORDER BY id ASC')
    .all(memberId);

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(JSON.parse(sub.subscription_json), JSON.stringify(payload));
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }

  return sent;
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
          ? `Heute ist 1 Aufgabe fällig: ${memberTasks[0].title}`
          : `Heute sind ${memberTasks.length} Aufgaben fällig.`;

      await sendPushToMember(member.id, {
        title: 'Familienplan – Heute',
        body,
        data: { type: 'daily', date: today }
      });

      db.prepare('UPDATE members SET last_daily_push_date = ? WHERE id = ?').run(today, member.id);
    }
  }
}

cron.schedule('0 7 * * *', () => {
  sendDailyReminders();
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

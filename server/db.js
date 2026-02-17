import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';

const dataDir =
  process.env.DB_DIR ||
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.RENDER_DISK_PATH ||
  path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'family-home.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS households (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    access_code TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL,
    locale TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL,
    last_daily_push_date TEXT,
    FOREIGN KEY (household_id) REFERENCES households(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    recurrence TEXT NOT NULL,
    due_date TEXT NOT NULL,
    primary_member_id INTEGER,
    secondary_member_id INTEGER,
    transferred_from_member_id INTEGER,
    transferred_at TEXT,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (household_id) REFERENCES households(id),
    FOREIGN KEY (primary_member_id) REFERENCES members(id),
    FOREIGN KEY (secondary_member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS task_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    completed_by_member_id INTEGER,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (completed_by_member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (household_id) REFERENCES households(id)
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    done_at TEXT,
    FOREIGN KEY (list_id) REFERENCES lists(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS meal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    meal TEXT,
    cook_member_id INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (household_id, date),
    FOREIGN KEY (household_id) REFERENCES households(id),
    FOREIGN KEY (cook_member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS meal_plan_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_plan_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (meal_plan_id, member_id),
    FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id),
    FOREIGN KEY (member_id) REFERENCES members(id)
  );
`);

function ensureColumn(table, column, type) {
  const existing = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

ensureColumn('tasks', 'transferred_from_member_id', 'INTEGER');
ensureColumn('tasks', 'transferred_at', 'TEXT');
ensureColumn('tasks', 'recurrence_rule', 'TEXT');
ensureColumn('tasks', 'last_evening_reminder_date', 'TEXT');
ensureColumn('tasks', 'last_penalty_date', 'TEXT');
ensureColumn('members', 'last_evening_push_date', 'TEXT');

export function nowISO() {
  return DateTime.utc().toISO();
}

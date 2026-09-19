#!/usr/bin/env node
/**
 * regen-hooks — read .thetacog/rules.db (SQLite) → write
 * .thetacog/hooks-config.json (the JSON the lexical hooks read).
 *
 * Self-heal step in the Shadow Agent loop:
 *   web UI edits SQLite → user (or auto-trigger) runs this →
 *   hooks-config.json regenerated → lexical voice-filter.sh reads
 *   the JSON on next commit.
 *
 * Single source of truth = SQLite. JSON is derived; if it drifts,
 * regenerate. Never hand-edit the JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const CWD = process.cwd();
const DB_PATH = path.join(CWD, '.thetacog', 'rules.db');
const JSON_PATH = path.join(CWD, '.thetacog', 'hooks-config.json');

if (!fs.existsSync(DB_PATH)) {
  console.error(`No SQLite at ${DB_PATH}. Run 'thetacog dashboard' first to seed it.`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const rules = db.prepare(`
  SELECT name, pattern, level, description, scope, enabled
  FROM voice_rules
  WHERE enabled = 1
  ORDER BY scope, level, name
`).all();

const hooks = (() => {
  try { return db.prepare('SELECT hook_name, enabled, description FROM hook_config ORDER BY hook_name').all(); }
  catch { return []; }
})();

const config = {
  generated_at: new Date().toISOString(),
  source: '.thetacog/rules.db (SQLite — single source of truth)',
  warning: 'AUTO-GENERATED. Do not hand-edit. Run `thetacog regen-hooks` after editing rules in the dashboard.',
  hooks,
  rules: rules.reduce((acc, r) => {
    if (!acc[r.scope]) acc[r.scope] = [];
    acc[r.scope].push({ name: r.name, pattern: r.pattern, level: r.level, description: r.description });
    return acc;
  }, {}),
};

fs.writeFileSync(JSON_PATH, JSON.stringify(config, null, 2));

console.log(`✓ Regenerated ${JSON_PATH}`);
console.log(`  ${rules.length} active rules across ${Object.keys(config.rules).length} scopes`);
console.log(`  ${hooks.length} hook configs`);

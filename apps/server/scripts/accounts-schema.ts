// Prints the SQL that brings the accounts database (D1) up to what sign-in needs, as Better
// Auth's own migration tool writes it. It starts from the migrations already in migrations/, so
// after a change to sign-in or an update to Better Auth it prints only what's new: save that as
// the next migration.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../src/auth-options.ts';

const folder = new URL('../migrations/', import.meta.url);
const database = new DatabaseSync(':memory:');
for (const file of readdirSync(folder)
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  database.exec(readFileSync(new URL(file, folder), 'utf8'));
}

const options = authOptions({
  appUrl: 'http://localhost',
  secret: 'only-used-to-print-the-schema-0123456789',
  database,
  beforeDeleteUser: async () => {},
});
const { compileMigrations } = await getMigrations(options);
const sql = (await compileMigrations()).trim();
process.stdout.write(`${sql.replace(/^;$/, '') || '-- Nothing new.'}\n`);

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Db, Statement } from '../worker/ideas.ts';

/** The site's D1 migrations, which make the ideas board's tables. */
const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** A statement on SQLite, with its values bound, as D1 prepares one. */
class SqliteStatement implements Statement {
  private readonly sqlite: DatabaseSync;
  private readonly query: string;
  private readonly values: SQLInputValue[];

  constructor(sqlite: DatabaseSync, query: string, values: SQLInputValue[] = []) {
    this.sqlite = sqlite;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]): Statement {
    return new SqliteStatement(this.sqlite, this.query, values.map(d1Value));
  }

  async first<T>(): Promise<T | null> {
    return (this.sqlite.prepare(this.query).get(...this.values) ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return {
      meta: { changes: Number(this.sqlite.prepare(this.query).run(...this.values).changes) },
    };
  }

  /** Runs it in a batch: a query gives its rows, and a change how many rows it changed. */
  step(): { results: unknown[]; meta: { changes: number } } {
    const prepared = this.sqlite.prepare(this.query);
    if (prepared.columns().length > 0) {
      return { results: prepared.all(...this.values), meta: { changes: 0 } };
    }
    return { results: [], meta: { changes: Number(prepared.run(...this.values).changes) } };
  }
}

/** A value as D1 binds it: true and false as 1 and 0, and undefined turned away, as D1 does. */
function d1Value(value: unknown): SQLInputValue {
  if (value === undefined) throw new TypeError('D1_TYPE_ERROR: Type ‘undefined’ not supported');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SQLInputValue;
}

/**
 * The ideas board's database, in memory on Node's own SQLite, with the site's migrations applied,
 * as D1 is: it binds values as D1 does, runs a batch as one transaction, keeps foreign keys, and
 * says how many rows a change changed. `sqlite` reaches in, to check what's kept.
 */
export function ideasDb(): Db & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  return {
    sqlite,
    prepare: (query) => new SqliteStatement(sqlite, query),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => (statement as SqliteStatement).step());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

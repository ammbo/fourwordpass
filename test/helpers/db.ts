import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export class Statement {
  constructor(public owner: DB, public sql: string, public args: SQLInputValue[] = []) {}
  bind(...args: SQLInputValue[]) { return new Statement(this.owner, this.sql, args); }
  async first() { return this.owner.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.args) }; }
  execRun() { const result = this.owner.sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
  async run() { return this.execRun(); }
}
export class DB {
  sqlite = new DatabaseSync(':memory:');
  failNextBatch = false;
  constructor() {
    const dir = new URL('../../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: Statement[]) {
    if (this.failNextBatch) { this.failNextBatch = false; throw new Error('Injected D1 interruption'); }
    this.sqlite.exec('BEGIN');
    try { const result = statements.map(s => s.execRun()); this.sqlite.exec('COMMIT'); return result; }
    catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
}

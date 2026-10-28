// Persistência em SQLite (módulo nativo node:sqlite) com escrita em lote.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const RETENTION_MS = 6 * 60 * 60 * 1000;

class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS readings (
        ts INTEGER NOT NULL, plot_id TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_readings_plot_ts ON readings (plot_id, ts);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, severity TEXT, source TEXT,
        plot_id TEXT, title TEXT, detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
    `);
    this.insReading = this.db.prepare('INSERT INTO readings (ts, plot_id, data) VALUES (?, ?, ?)');
    this.insEvent = this.db.prepare(
      'INSERT OR IGNORE INTO events (id, ts, severity, source, plot_id, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.queue = [];
    this.writes = 0;
    this.lastFlushMs = 0;
  }

  enqueueReading(ts, plotId, metrics) {
    this.queue.push([ts, plotId, JSON.stringify(metrics)]);
  }

  /** Grava o lote pendente numa única transação; retorna quantas linhas escreveu. */
  flush() {
    if (!this.queue.length) return 0;
    const batch = this.queue;
    this.queue = [];
    const t0 = performance.now();
    this.db.exec('BEGIN');
    try {
      for (const row of batch) this.insReading.run(...row);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.lastFlushMs = performance.now() - t0;
    this.writes += batch.length;
    return batch.length;
  }

  saveEvent(e) {
    this.insEvent.run(e.id, e.ts, e.severity, e.source, e.plotId || null, e.title, e.detail || null);
    this.writes += 1;
  }

  recentEvents(limit) {
    return this.db
      .prepare('SELECT id, ts, severity, source, plot_id AS plotId, title, detail FROM events ORDER BY ts DESC LIMIT ?')
      .all(limit)
      .reverse();
  }

  history(plotId, sinceTs, maxPoints = 240) {
    const rows = this.db
      .prepare('SELECT ts, data FROM readings WHERE plot_id = ? AND ts >= ? ORDER BY ts')
      .all(plotId, sinceTs);
    const step = Math.max(1, Math.ceil(rows.length / maxPoints));
    const out = [];
    for (let i = 0; i < rows.length; i += step) out.push({ ts: rows[i].ts, ...JSON.parse(rows[i].data) });
    return out;
  }

  stats() {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM readings').get();
    let sizeBytes = 0;
    for (const suffix of ['', '-wal']) {
      try { sizeBytes += fs.statSync(this.file + suffix).size; } catch { /* ainda não existe */ }
    }
    return { rows: n, sizeBytes };
  }

  prune() {
    const cutoff = Date.now() - RETENTION_MS;
    this.db.prepare('DELETE FROM readings WHERE ts < ?').run(cutoff);
    this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
  }
}

module.exports = { Store };

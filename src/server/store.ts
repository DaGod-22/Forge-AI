import fs from 'node:fs';
import path from 'node:path';
import { stateRoot } from './config.js';

export class JsonStore {
  constructor(private readonly root = path.join(stateRoot, 'data')) {
    fs.mkdirSync(this.root, { recursive: true });
  }

  private tablePath(table: string) {
    if (!/^[a-z0-9_-]+$/i.test(table)) throw new Error(`Invalid table name ${table}`);
    return path.join(this.root, `${table}.json`);
  }

  read<T>(table: string, fallback: T): T {
    const file = this.tablePath(table);
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  }

  write<T>(table: string, value: T): T {
    const file = this.tablePath(table);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return value;
  }

  update<T>(table: string, fallback: T, mutator: (value: T) => T): T {
    const next = mutator(this.read(table, fallback));
    return this.write(table, next);
  }
}

export const store = new JsonStore();

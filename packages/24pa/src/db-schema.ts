import { MIGRATIONS } from './db.js';

// Shared migration declarations drive SQLite coercion and restored-schema checks.
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map(p => p.trim()).filter(Boolean);
}

export function migrationColumns(maxVersion = Infinity): Record<string, Record<string, string>> {
  const kinds: Record<string, Record<string, string>> = {};
  const learn = (table: string, name: string, type: string) => {
    (kinds[table] ??= {})[name] = type;
  };
  for (const migration of MIGRATIONS.filter(row => row.version <= maxVersion)) {
    for (const stmt of migration.statements) {
      let m = /^create table (?:if not exists )?pa24\.(\w+)\s*\(([\s\S]*)\)\s*$/.exec(stmt.trim());
      if (m) {
        // Trim the outer parens content carefully: the regex above is greedy —
        // rebuild via first '(' to last ')'.
        const open = stmt.indexOf('(');
        const close = stmt.lastIndexOf(')');
        const body = stmt.slice(open + 1, close);
        const table = m[1]!;
        let learned = 0;
        for (const col of splitTopLevel(body)) {
          const cm = /^(\w+)\s+(.+)$/.exec(col);
          if (!cm || /^(primary|foreign|unique|check|constraint)\b/i.test(cm[1]!)) continue;
          learn(table, cm[1]!, cm[2]!);
          learned += 1;
        }
        // Fail loud, symmetric with query translation: a matched CREATE TABLE
        // that parsed to zero columns means the DDL shape drifted.
        if (learned === 0) throw new Error(`迁移列声明解析失败：pa24.${table} 未解析出任何列。`);
        continue;
      }
      m = /^alter table pa24\.(\w+) add column (?:if not exists )?(\w+)\s+(.+)$/.exec(stmt.trim());
      if (m) learn(m[1]!, m[2]!, m[3]!);
    }
  }
  return kinds;
}


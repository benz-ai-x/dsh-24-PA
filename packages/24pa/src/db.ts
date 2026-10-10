// Backend-agnostic database surface (F25): the business ledger runs on
// SQLite by default or PostgreSQL by explicit workspace choice, and repos
// program against this interface only. No silent fallback — whichever
// backend the config names is the backend that runs, or startup fails loud.

export interface PaQueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Anything that can run business SQL — the pool itself or a tx client. */
export interface PaQueryer {
  query<T extends Record<string, any> = Record<string, any>>(text: string, values?: readonly unknown[]): Promise<PaQueryResult<T>>;
}

export interface PaDb extends PaQueryer {
  readonly kind: 'postgres' | 'sqlite';
  /** SQLite only: absolute path of the ledger file (backup support). */
  readonly filePath?: string;
  check(): Promise<void>;
  migrate(): Promise<number>;
  schemaVersion(): Promise<number>;
  /** Note numbering N-1, N-2… (PG sequence / SQLite counter table). */
  nextNoteSeq(): Promise<number>;
  withTransaction<T>(work: (client: PaQueryer) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

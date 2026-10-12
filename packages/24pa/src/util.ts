// Tiny shared helpers (F29): used by both the runtime and the handwriting
// pipeline — a leaf module so the two never import each other for values.

export const nowIso = (): string => new Date().toISOString();

export const text = (value: unknown, max = 12000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 字的内容。`);
  return value.trim();
};

export const isoDate = (value: Date | string | null): string | null => (value == null ? null : new Date(value).toISOString());

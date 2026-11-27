// Reading what the scripted model was sent, for tests that record requests.
/** Every string a recorded request carries, whatever block shape the Host used. */
export const strings = value => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
/** All the text of one recorded request. */
export const said = request => strings(request.inputs).join('\n');
/** The first value in a nested structure that satisfies `predicate`, or undefined. */
export const find = (value, predicate) => {
  if (!value || typeof value !== 'object') return undefined;
  if (predicate(value)) return value;
  for (const inner of Object.values(value)) { const hit = find(inner, predicate); if (hit) return hit; }
  return undefined;
};

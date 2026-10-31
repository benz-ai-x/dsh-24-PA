/** Diagnostics may quote platform errors, never credentials. Resource IDs and
 * identity IDs stay visible so the owner can identify the affected binding. */
const sensitiveKey = (key: string): boolean => /(accesstoken|refreshtoken|secret|apikey|authorization|password)$/
  .test(key.toLowerCase().replace(/[_-]/g, ''));

export function redactDiagnostic<T>(value: T, secrets: string[] = []): T {
  const redact = (text: string): string => {
    let result = text;
    for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[已隐藏]');
    return result
      .replace(/(authorization["']?\s*[=:]\s*["']?)(?:[A-Za-z]+\s+)?[^\s"',}<>]+/gi, '$1[已隐藏]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
      .replace(/((?:access_token|refresh_token|app_secret|client_secret|api_key|authorization|password)["']?\s*[=:]\s*["']?)[^\s"',}<>]+/gi, '$1[已隐藏]')
      .replace(/(postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已隐藏]@');
  };
  const visit = (item: any): any => typeof item === 'string' ? redact(item)
    : Array.isArray(item) ? item.map(visit)
    : item && typeof item === 'object' && !(item instanceof Date)
      ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key,
        sensitiveKey(key) ? '[已隐藏]' : visit(child)]))
      : item;
  return visit(value);
}

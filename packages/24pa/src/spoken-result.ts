/** 口播正文上限（spec 2.2）：超限截断并在语音内播报提示。 */
export const DIGEST_SPOKEN_MAX_CHARS = 1200;

/**
 * 口播变体（F19）：剥离只对阅读有意义的元数据——同步时间戳、来源括注、
 * 文档链接与页脚——再截断到上限并播报提示。影响安排的缺失仍播报。纯文本变换，
 * 不依赖 facts 结构，对 renderDigest 的最终输出做稳定降维。
 */
export function buildSpokenVariant(report: string): string {
  const spoken: string[] = [];
  for (const raw of report.split('\n')) {
    const line = raw.trim();
    if (line === '三、数据缺失') continue;
    if (line.startsWith('来源：')) continue; // 页脚
    const out = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
      .replace(/（日历同步于[^）]*）/g, '')
      .replace(/（审核于[^）]*）/g, '')
      .replace(/（来源：[^）]*）/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trimEnd();
    spoken.push(out);
  }
  const text = spoken.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= DIGEST_SPOKEN_MAX_CHARS) return text;
  return `${text.slice(0, DIGEST_SPOKEN_MAX_CHARS)}\n……正文较长，语音版到此截断，完整内容请看随后的文字版。`;
}


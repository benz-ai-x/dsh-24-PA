import { SaxesParser } from 'saxes';

export interface DocumentNode { name: string; attributes: Record<string, string>; children: Array<DocumentNode | string> }
const supported = new Set('title p h1 h2 h3 h4 h5 h6 h7 h8 h9 ul ol li table tr td th thead tbody tfoot img br b strong i em u s span a code pre blockquote'.split(' '));
const metadata = new Set(['id', 'block-id', 'block_id', 'token', 'ref', 'render-time', 'render_time']);

/** Strictly parse the static template subset. Unsupported/dynamic content
 * cannot silently disappear from a full-document approval. */
export function parseNoteDocument(xml: string): DocumentNode {
  const root: DocumentNode = { name: 'root', attributes: {}, children: [] }, stack = [root];
  const parser = new SaxesParser<{ xmlns: false; fragment: true }>({ xmlns: false, fragment: true });
  parser.on('doctype', () => { throw new Error('文档含不支持的 DTD，不能核验整稿。'); });
  parser.on('opentag', tag => {
    if (!supported.has(tag.name)) throw new Error(`文档块 ${tag.name} 尚无完整静态快照，不能核验整稿。`);
    const node: DocumentNode = { name: tag.name, attributes: { ...tag.attributes }, children: [] };
    stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on('text', text => { stack.at(-1)!.children.push(text); });
  parser.on('cdata', text => { stack.at(-1)!.children.push(text); });
  parser.on('closetag', () => { stack.pop(); });
  parser.write(xml).close();
  return root;
}

export function documentText(node: DocumentNode): string {
  return node.children.map(child => typeof child === 'string' ? child : documentText(child)).join('').replace(/\s+/g, ' ').trim();
}

/** Only the first body paragraph matching the registered status grammar is
 * system-owned. Arbitrary prefixed paragraphs and duplicates remain content. */
export function registeredStatus(root: DocumentNode): DocumentNode | null {
  const first = root.children.find(child => typeof child !== 'string' && child.name !== 'title');
  if (typeof first === 'string' || first?.name !== 'p' || first.children.some(child => typeof child !== 'string')) return null;
  const value = documentText(first);
  const identity = 'N-\\d+ v\\d+';
  const instant = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z';
  const registered = [
    `待本人审核 ${identity}（尚未经人工审核）`,
    `本人已审核 ${identity}（${instant}；覆盖指纹 [a-f0-9]{12}…）`,
    `本人退回 ${identity}（${instant}）；修改后可要求重新发布候选`,
  ];
  return registered.some(pattern => new RegExp(`^【24PA·系统】审核状态：${pattern}$`).test(value)) ? first : null;
}

/** Preserve structure and image positions; supplied hashes bind actual media
 * bytes. Without hashes this is structural normalization only (test readers). */
export function canonicalDocument(xml: string, mediaHashes?: readonly string[]): string {
  const root = parseNoteDocument(xml), status = registeredStatus(root);
  let imageIndex = 0;
  const encode = (node: DocumentNode | string): unknown => {
    if (typeof node === 'string') return node.replace(/\s+/g, ' ').trim();
    const attrs = Object.fromEntries(Object.entries(node.attributes).filter(([key]) => !metadata.has(key) && !(node.name === 'img' && ['src', 'url'].includes(key))).sort(([a], [b]) => a.localeCompare(b)));
    if (node.name === 'img') attrs.sha256 = mediaHashes ? mediaHashes[imageIndex++]! : 'unverified-image';
    if (node.name === 'img' && !attrs.sha256) throw new Error('图片资源摘要缺失，不能核验整稿。');
    return [node.name, attrs, node.children.map(encode).filter(value => value !== '')];
  };
  const canonical = root.children.filter(node => node !== status).map(encode).filter(value => value !== '');
  if (mediaHashes && imageIndex !== mediaHashes.length) throw new Error('图片资源数量与快照不符。');
  return 'note-document-v2\n' + canonical.map(value => JSON.stringify(value)).join('\n');
}

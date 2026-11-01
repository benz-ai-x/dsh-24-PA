import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../client.js');
const text = readFileSync(path, 'utf8');
const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
const within = (node, predicate) => {
  for (let current = node; current; current = current.parent) if (predicate(current)) return true;
  return false;
};
const withinZh = node => within(node, current => ts.isVariableDeclaration(current) && current.name.getText(source) === 'zh');
const withinL = node => within(node, current => ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'L');
const bilingualTuple = node => {
  const parent = node.parent;
  if (!ts.isArrayLiteralExpression(parent) || parent.elements.length < 2) return false;
  const strings = parent.elements.filter(ts.isStringLiteral);
  return strings.length >= 2 && !/[\u3400-\u9fff]/.test(strings.at(-1).text);
};
const uncovered = [];
const visit = node => {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && /[\u3400-\u9fff]/.test(node.getText(source))
    && !withinL(node) && !withinZh(node) && !bilingualTuple(node)) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    uncovered.push(`${path}:${position.line + 1} ${node.getText(source).slice(0, 180)}`);
  }
  ts.forEachChild(node, visit);
};
visit(source);

describe('24PA 全站中英文源码契约', () => {
  it('中文 UI 字符串必须接入 L()、zh 字典或中英双语元组', () => {
    expect(uncovered).toEqual([]);
  });

  it('英文技术错误有明确的回退，不直接裸露中文后端消息', () => {
    expect(text).toContain('const technicalText = value =>');
    expect(text).toContain("return 'The operation could not be completed. Retry or review the technical details.'");
    expect(text).toContain('error.originalMessage = result.error.message');
  });

  it('日期格式跟随宿主语言快照而不是固定中文 locale', () => {
    expect(text).toContain("typeof snapshot === 'string' ? snapshot : snapshot?.active");
    expect(text).toContain("startsWith('en') ? 'en-US' : 'zh-CN'");
    expect(text).toContain('toLocaleString(displayLocale()');
  });
});

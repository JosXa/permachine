import { describe, test, expect } from 'bun:test';
import { MarkdownAdapter } from '../../src/adapters/markdown-adapter';

describe('markdown-adapter', () => {
  const adapter = new MarkdownAdapter();

  test('merges bodies with exactly one blank line between them', () => {
    const base = adapter.parse('# Shared\n\nUse bun.\n');
    const machine = adapter.parse('\n\n## Local\n\nUse local profile.\n');

    const merged = adapter.merge(base, machine);

    expect(adapter.serialize(merged)).toBe('# Shared\n\nUse bun.\n\n## Local\n\nUse local profile.\n');
  });

  test('deep-merges YAML frontmatter and lets machine values win', () => {
    const base = adapter.parse(`---
title: Base Agents
tools:
  shell: bun
shared: true
---
# Shared
`);

    const machine = adapter.parse(`---
tools:
  shell: bunx
machine: laptop
---
## Local
`);

    const merged = adapter.merge(base, machine);
    const output = adapter.serialize(merged);

    expect(output).toContain('title: Base Agents');
    expect(output).toContain('shell: bunx');
    expect(output).toContain('machine: laptop');
    expect(output).toContain('shared: true');
  });

  test('keeps machine frontmatter when base has none', () => {
    const base = adapter.parse('# Shared\n');
    const machine = adapter.parse(`---
machine: laptop
---
## Local
`);

    const output = adapter.serialize(adapter.merge(base, machine));

    expect(output).toContain('machine: laptop');
    expect(output).toContain('# Shared');
    expect(output).toContain('## Local');
  });
});

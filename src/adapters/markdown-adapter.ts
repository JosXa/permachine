import type { FileAdapter } from './base.js';
import { parseDocument, stringify } from 'yaml';

interface MarkdownDocument {
  frontmatter: unknown | null;
  body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export class MarkdownAdapter implements FileAdapter {
  canHandle(extension: string): boolean {
    return extension === '.md' || extension === '.markdown';
  }

  parse(content: string): MarkdownDocument {
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      return {
        frontmatter: null,
        body: content,
      };
    }

    try {
      const frontmatter = parseDocument(match[1]).toJSON();

      return {
        frontmatter: frontmatter ?? null,
        body: content.slice(match[0].length),
      };
    } catch (error) {
      throw new Error(`Failed to parse Markdown frontmatter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  merge(base: MarkdownDocument, machine: MarkdownDocument): MarkdownDocument {
    return {
      frontmatter: this.mergeFrontmatter(base.frontmatter, machine.frontmatter),
      body: this.mergeBodies(base.body, machine.body),
    };
  }

  serialize(data: MarkdownDocument): string {
    const sections: string[] = [];

    if (data.frontmatter !== null) {
      const frontmatterText = stringify(data.frontmatter, { indent: 2 });
      sections.push(`---\n${frontmatterText.trimEnd()}\n---`);
    }

    if (data.body.trim().length > 0) {
      sections.push(data.body.trim());
    }

    return sections.length > 0 ? sections.join('\n\n') + '\n' : '';
  }

  private mergeBodies(baseBody: string, machineBody: string): string {
    const trimmedBase = baseBody.trimEnd();
    const trimmedMachine = machineBody.trimStart();

    if (!trimmedBase) {
      return trimmedMachine;
    }

    if (!trimmedMachine) {
      return trimmedBase;
    }

    // User requirement: join base and machine Markdown with exactly one blank line.
    return `${trimmedBase}\n\n${trimmedMachine}`;
  }

  private mergeFrontmatter(base: unknown | null, machine: unknown | null): unknown | null {
    if (machine === null) {
      return base;
    }

    if (base === null) {
      return machine;
    }

    if (!this.isPlainObject(base) || !this.isPlainObject(machine)) {
      return machine;
    }

    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(machine)) {
      if (key in result) {
        result[key] = this.mergeFrontmatter(result[key] as unknown, value as unknown);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

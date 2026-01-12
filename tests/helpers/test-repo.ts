import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execAsync = promisify(exec);

export class TestRepo {
  public path: string;

  constructor(public name: string) {
    this.path = path.join(os.tmpdir(), `mcs-test-${name}-${Date.now()}`);
  }

  async create(): Promise<void> {
    await fs.mkdir(this.path, { recursive: true });
    await execAsync('git init', { cwd: this.path });
    await execAsync('git config user.email "test@example.com"', { cwd: this.path });
    await execAsync('git config user.name "Test User"', { cwd: this.path });
  }

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.path, filePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.path, filePath);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.path, filePath));
      return true;
    } catch {
      return false;
    }
  }

  async commit(message: string): Promise<void> {
    await execAsync('git add -A', { cwd: this.path });
    await execAsync(`git commit -m "${message}"`, { cwd: this.path });
  }

  async getGitConfig(key: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`git config --get ${key}`, { cwd: this.path });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    return await execAsync(command, { cwd: this.path });
  }
}

export async function createTestFiles(repo: TestRepo, files: Record<string, string>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    await repo.writeFile(filePath, content);
  }
}

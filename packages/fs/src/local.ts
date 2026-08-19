import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Context } from '@mini-dsh/cordis'
import { FileSystem, FsError, type FsEditRequest, type FsInfo } from './service.ts'

export interface LocalFileSystemConfig {
  /** Resolution default for relative paths — NOT a containment boundary. */
  cwd?: string
}

export class LocalFileSystem extends FileSystem {
  private readonly cwd: string

  constructor(ctx: Context, config: LocalFileSystemConfig = {}) {
    super(ctx)
    this.cwd = config.cwd ?? process.cwd()
  }

  resolve(path: string): string {
    return resolve(this.cwd, path)
  }

  async stat(path: string): Promise<FsInfo | undefined> {
    try {
      const info = await stat(this.resolve(path))
      return { type: info.isDirectory() ? 'directory' : 'file', size: info.size }
    } catch {
      return undefined
    }
  }

  async readText(path: string): Promise<string> {
    const target = this.resolve(path)
    try {
      return await readFile(target, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FsError('FS_NOT_FOUND', `file not found: ${target}`)
      }
      throw error
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    const target = this.resolve(path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }

  async editText(path: string, edit: FsEditRequest): Promise<{ replacements: number }> {
    const before = await this.readText(path)
    const occurrences = before.split(edit.oldString).length - 1
    if (occurrences === 0) {
      throw new FsError('FS_EDIT_NOT_FOUND', `old_string not found in ${this.resolve(path)}`)
    }
    if (occurrences > 1 && !edit.replaceAll) {
      throw new FsError('FS_AMBIGUOUS_EDIT', `old_string appears ${occurrences} times; pass replace_all or a longer unique string`)
    }
    const after = edit.replaceAll
      ? before.split(edit.oldString).join(edit.newString)
      : before.replace(edit.oldString, edit.newString)
    await this.writeText(path, after)
    return { replacements: edit.replaceAll ? occurrences : 1 }
  }
}

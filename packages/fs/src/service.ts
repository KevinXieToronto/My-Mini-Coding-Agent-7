import { Service, type Context } from '@mini-dsh/cordis'

export type FsErrorCode = 'FS_NOT_FOUND' | 'FS_EDIT_NOT_FOUND' | 'FS_AMBIGUOUS_EDIT' | 'FS_DENIED'

export class FsError extends Error {
  constructor(readonly code: FsErrorCode, message: string) {
    super(message)
    this.name = code
  }
}

export interface FsEditRequest {
  oldString: string
  newString: string
  replaceAll: boolean
}

export interface FsInfo {
  type: 'file' | 'directory'
  size: number
}

declare module '@mini-dsh/cordis' {
  interface Context {
    fs: FileSystem
  }
}

/**
 * The filesystem SERVICE DEFINITION. Tools depend on this abstract class
 * only; which provider is mounted (local, sandboxed, remote) is a
 * composition-time decision.
 */
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  /** Resolve a user/model-supplied path to an absolute display path. */
  abstract resolve(path: string): string
  abstract stat(path: string): Promise<FsInfo | undefined>
  abstract readText(path: string): Promise<string>
  abstract writeText(path: string, content: string): Promise<void>
  abstract editText(path: string, edit: FsEditRequest): Promise<{ replacements: number }>
}

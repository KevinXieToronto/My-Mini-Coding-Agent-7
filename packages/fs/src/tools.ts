import type { Context } from '@mini-dsh/cordis'
import { defineTool } from '@mini-dsh/tools'

export const name = 'tool-fs'
export const inject = ['tools', 'fs'] as const

/** The fs tools consume ctx.fs exclusively — never node:fs. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: 'Maximum number of lines to return. Defaults to 2000.' },
    },
    execute: async (args) => {
      const text = await ctx.fs.readText(args.file_path)
      const lines = text.split('\n')
      const offset = Math.max(1, args.offset ?? 1)
      const limit = Math.max(1, args.limit ?? 2000)
      const window = lines.slice(offset - 1, offset - 1 + limit)
      return window.map((line, i) => `${offset + i}\t${line}`).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, resolved by the filesystem backend.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
    },
    execute: async (args) => {
      await ctx.fs.writeText(args.file_path, args.content)
      return `wrote ${args.content.length} characters to ${ctx.fs.resolve(args.file_path)}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'edit',
    description: 'Edit an existing UTF-8 text file by replacing literal text.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
      old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
      new_string: { type: 'string', required: true, description: 'Replacement text. Use an empty string to delete the match.' },
      replace_all: { type: 'boolean', description: 'Defaults to false; when false, old_string must appear exactly once.' },
    },
    execute: async (args) => {
      const { replacements } = await ctx.fs.editText(args.file_path, {
        oldString: args.old_string,
        newString: args.new_string,
        replaceAll: args.replace_all ?? false,
      })
      return `replaced ${replacements} occurrence(s) in ${ctx.fs.resolve(args.file_path)}`
    },
  }))
}

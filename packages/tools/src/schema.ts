import type { ToolSchema } from '@mini-dsh/llm'
import type { ContentBlock } from '@mini-dsh/core'
import type { ToolRunContext } from './runtime.ts'

/**
 * Ergonomic parameter authoring — compiled to real JSON Schema for the model
 * and to a static TypeScript type for the execute body (mirrors the real
 * repo's defineTool / ParameterSchemaSpec).
 */
export interface ParameterField {
  type: 'string' | 'number' | 'boolean'
  description: string
  required?: boolean
  enum?: readonly string[]
}

export type ParameterSpec = Record<string, ParameterField>

type TypeOf<T extends ParameterField['type']> = T extends 'string' ? string : T extends 'number' ? number : boolean
type RequiredKeys<S extends ParameterSpec> = { [K in keyof S]: S[K]['required'] extends true ? K : never }[keyof S]
type OptionalKeys<S extends ParameterSpec> = Exclude<keyof S, RequiredKeys<S>>
export type InferArgs<S extends ParameterSpec> = { [K in RequiredKeys<S>]: TypeOf<S[K]['type']> } & {
  [K in OptionalKeys<S>]?: TypeOf<S[K]['type']>
}

export class ToolArgsError extends Error {
  readonly code = 'INVALID_ARGS'
}

export function parametersToJsonSchema(spec: ParameterSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(spec)) {
    properties[key] = {
      type: field.type,
      description: field.description,
      ...(field.enum !== undefined ? { enum: [...field.enum] } : {}),
    }
    if (field.required === true) required.push(key)
  }
  return { type: 'object', properties, required }
}

function validateArgs(spec: ParameterSpec, args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolArgsError(`arguments must be a JSON object, received ${Array.isArray(args) ? 'array' : typeof args}`)
  }
  const record = args as Record<string, unknown>
  for (const [key, field] of Object.entries(spec)) {
    const value = record[key]
    if (value === undefined) {
      if (field.required === true) throw new ToolArgsError(`missing required argument "${key}"`)
      continue
    }
    if (typeof value !== field.type) {
      throw new ToolArgsError(`argument "${key}" must be a ${field.type}, received ${typeof value}`)
    }
    if (field.enum !== undefined && !field.enum.includes(value as string)) {
      throw new ToolArgsError(`argument "${key}" must be one of: ${field.enum.join(', ')}`)
    }
  }
  return record
}

/** A registered tool: schema for the model + validated execute for the runtime. */
export interface ToolDefinition extends ToolSchema {
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /** Optional: how the returned value reads back to the model. Default: text as-is, else pretty JSON. */
  render?(value: unknown): ContentBlock[]
}

export interface DefineToolOptions<S extends ParameterSpec> {
  name: string
  description: string
  parameters: S
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<unknown>
  render?(value: unknown): ContentBlock[]
}

/** Compile the spec to JSON Schema and wrap execute so bad args fail BEFORE the body runs. */
export function defineTool<S extends ParameterSpec>(options: DefineToolOptions<S>): ToolDefinition {
  return {
    name: options.name,
    description: options.description,
    parameters: parametersToJsonSchema(options.parameters),
    execute: (args, exec) => options.execute(validateArgs(options.parameters, args) as InferArgs<S>, exec),
    ...(options.render !== undefined ? { render: options.render } : {}),
  }
}

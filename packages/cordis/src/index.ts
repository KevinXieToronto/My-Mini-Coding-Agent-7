/**
 * @mini-dsh/cordis — a miniature of the Cordis plugin framework.
 *
 * Everything is a plugin: plugins contribute services, typed events, and
 * reversible effects to a shared Context. There is no privileged core.
 */

export type Disposable = () => void

type AnyFn = (...args: any[]) => any

/**
 * The typed event map. Packages extend it via declaration merging:
 *
 *   declare module '@mini-dsh/cordis' {
 *     interface Events { 'my/event'(payload: string): void }
 *   }
 */
export interface Events {
  'internal/service'(name: string): void
  'internal/plugin'(fiber: Fiber): void
}

type EventArgs<K extends keyof Events> = Events[K] extends AnyFn ? Parameters<Events[K]> : never
type EventReturn<K extends keyof Events> = Events[K] extends AnyFn ? ReturnType<Events[K]> : never

export interface PluginMeta {
  name?: string
  /** Services that must exist before this plugin activates. */
  inject?: readonly string[]
}

export type FunctionPlugin<C = any> = ((ctx: Context, config: C) => void) & PluginMeta
export type ConstructorPlugin<C = any> = (new (ctx: Context, config: C) => unknown) & PluginMeta
export interface ObjectPlugin<C = any> extends PluginMeta {
  apply(ctx: Context, config: C): void
}
export type Plugin<C = any> = FunctionPlugin<C> | ConstructorPlugin<C> | ObjectPlugin<C>

interface Hook {
  callback: AnyFn
}

/** Shared by every Context: the service table, event hooks, and pending fibers. */
class Registry {
  services = new Map<string, unknown>()
  hooks = new Map<string, Hook[]>()
  pending: Fiber[] = []
  private flushing = false

  /** Activate every pending fiber whose injected services all exist, to fixpoint. */
  flush(): void {
    if (this.flushing) return
    this.flushing = true
    try {
      let progressed = true
      while (progressed) {
        progressed = false
        for (const fiber of [...this.pending]) {
          if (fiber.state !== 'pending') {
            this.unqueue(fiber)
            continue
          }
          if (fiber.tryActivate()) {
            this.unqueue(fiber)
            progressed = true
          }
        }
      }
    } finally {
      this.flushing = false
    }
  }

  private unqueue(fiber: Fiber): void {
    const index = this.pending.indexOf(fiber)
    if (index >= 0) this.pending.splice(index, 1)
  }
}

export type FiberState = 'pending' | 'active' | 'disposed'

/**
 * One fiber per plugin registration. It owns the plugin's child context and
 * the stack of disposers produced by the plugin's effects.
 */
export class Fiber {
  state: FiberState = 'pending'
  ctx!: Context
  runner: (() => void) | null = null
  private disposables: Disposable[] = []

  constructor(
    readonly name: string,
    readonly inject: readonly string[],
  ) {}

  /** Activate if every injected service exists. Returns true when activated. */
  tryActivate(): boolean {
    if (this.state !== 'pending') return false
    const services = this.ctx.registry.services
    if (!this.inject.every((name) => services.has(name))) return false
    this.state = 'active'
    this.runner?.()
    this.ctx.emit('internal/plugin', this)
    return true
  }

  /** Which injected services are still missing (for diagnostics). */
  missing(): string[] {
    const services = this.ctx.registry.services
    return this.inject.filter((name) => !services.has(name))
  }

  /** Track a disposer; returns an idempotent wrapper that also unregisters itself. */
  addDisposable(dispose: Disposable): Disposable {
    let done = false
    const wrapped = () => {
      if (done) return
      done = true
      const index = this.disposables.indexOf(wrapped)
      if (index >= 0) this.disposables.splice(index, 1)
      dispose()
    }
    this.disposables.push(wrapped)
    return wrapped
  }

  /** Undo everything this plugin registered, in reverse order. */
  dispose(): void {
    if (this.state === 'disposed') return
    this.state = 'disposed'
    const list = [...this.disposables]
    for (let i = list.length - 1; i >= 0; i--) list[i]!()
    this.disposables = []
  }
}

function isClass(fn: Function): boolean {
  return /^\s*class[\s{]/.test(Function.prototype.toString.call(fn))
}

function resolvePlugin(plugin: Plugin, config: unknown): { name: string; inject: readonly string[]; run: (ctx: Context) => void } {
  if (typeof plugin === 'function') {
    if (isClass(plugin)) {
      const ctor = plugin as ConstructorPlugin
      return {
        name: ctor.name || 'anonymous',
        inject: ctor.inject ?? [],
        run: (ctx) => void new ctor(ctx, config),
      }
    }
    const fn = plugin as FunctionPlugin
    return {
      name: fn.name || 'anonymous',
      inject: fn.inject ?? [],
      run: (ctx) => fn(ctx, config),
    }
  }
  if (plugin !== null && typeof plugin === 'object' && typeof plugin.apply === 'function') {
    return {
      name: plugin.name ?? 'anonymous',
      inject: plugin.inject ?? [],
      run: (ctx) => plugin.apply(ctx, config),
    }
  }
  throw new Error(`invalid plugin: expected a function, class, or object with an "apply" method, received ${typeof plugin}`)
}

const serviceProxyHandler: ProxyHandler<Context> = {
  get(target, prop, receiver) {
    if (typeof prop === 'symbol' || Reflect.has(target, prop)) {
      return Reflect.get(target, prop, receiver)
    }
    const services = target.registry.services
    if (services.has(prop)) return services.get(prop)
    return undefined
  },
}

export class Context {
  readonly registry: Registry
  readonly fiber: Fiber
  readonly root: Context

  constructor(registry?: Registry, fiber?: Fiber, root?: Context) {
    this.registry = registry ?? new Registry()
    if (fiber === undefined) {
      fiber = new Fiber('root', [])
      fiber.state = 'active'
    }
    this.fiber = fiber
    const self = new Proxy(this, serviceProxyHandler)
    this.root = root ?? self
    if (fiber.ctx === undefined) fiber.ctx = self
    return self
  }

  /** Register a plugin. It activates as soon as its injected services all exist. */
  plugin<C>(plugin: Plugin<C>, config?: C): Fiber {
    if (this.fiber.state === 'disposed') throw new Error('cannot register a plugin on a disposed context')
    const resolved = resolvePlugin(plugin, config)
    const fiber = new Fiber(resolved.name, resolved.inject)
    fiber.ctx = new Context(this.registry, fiber, this.root)
    fiber.runner = () => resolved.run(fiber.ctx)
    // Disposing the parent plugin disposes this child plugin too.
    this.fiber.addDisposable(() => fiber.dispose())
    this.registry.pending.push(fiber)
    this.registry.flush()
    return fiber
  }

  /** Scoped sugar: run `callback` once the listed services exist. */
  inject(deps: readonly string[], callback: (ctx: Context) => void): Fiber {
    return this.plugin({ name: callback.name || 'inline', inject: deps, apply: (ctx) => callback(ctx) })
  }

  /**
   * Publish a service under `name` (read back as `ctx.<name>`).
   * A reversible effect: the returned disposer (or disposing the providing
   * plugin) removes the service again.
   */
  provide(name: string, value: unknown): Disposable {
    return this.effect(() => {
      if (this.registry.services.has(name)) {
        throw new Error(`service "${name}" is already registered`)
      }
      this.registry.services.set(name, value)
      this.emit('internal/service', name)
      this.registry.flush()
      return () => {
        this.registry.services.delete(name)
      }
    }, `ctx.provide(${JSON.stringify(name)})`)
  }

  /** Optional service lookup: undefined when absent (never throws). */
  get(name: string): unknown {
    return this.registry.services.get(name)
  }

  /**
   * Run `execute` immediately and track the disposer it returns on this
   * plugin's fiber. Disposers run in reverse order on dispose.
   */
  effect(execute: () => Disposable, label = 'anonymous'): Disposable {
    if (this.fiber.state === 'disposed') {
      throw new Error(`cannot create effect "${label}" on a disposed context`)
    }
    const dispose = execute()
    return this.fiber.addDisposable(dispose)
  }

  /** Listen to a typed event. Registration is an effect (auto-removed on dispose). */
  on<K extends keyof Events>(name: K, listener: Events[K] & AnyFn, options?: { prepend?: boolean }): Disposable {
    return this.effect(() => {
      let hooks = this.registry.hooks.get(name)
      if (hooks === undefined) {
        hooks = []
        this.registry.hooks.set(name, hooks)
      }
      const hook: Hook = { callback: listener as AnyFn }
      if (options?.prepend === true) hooks.unshift(hook)
      else hooks.push(hook)
      return () => {
        const index = hooks.indexOf(hook)
        if (index >= 0) hooks.splice(index, 1)
      }
    }, `ctx.on(${JSON.stringify(name)})`)
  }

  private hooksOf(name: string): AnyFn[] {
    return [...(this.registry.hooks.get(name) ?? [])].map((hook) => hook.callback)
  }

  /** Fire-and-forget: call every listener synchronously, ignore results. */
  emit<K extends keyof Events>(name: K, ...args: EventArgs<K>): void {
    for (const callback of this.hooksOf(name)) callback(...args)
  }

  /** Await all listeners concurrently; throws AggregateError if any rejected. */
  async parallel<K extends keyof Events>(name: K, ...args: EventArgs<K>): Promise<void> {
    const settled = await Promise.allSettled(this.hooksOf(name).map((callback) => callback(...args)))
    const failures = settled.filter((entry) => entry.status === 'rejected')
    if (failures.length > 0) {
      throw new AggregateError(failures.map((entry) => (entry as PromiseRejectedResult).reason))
    }
  }

  /** Call listeners in order; the first non-null/false/undefined result wins. */
  bail<K extends keyof Events>(name: K, ...args: EventArgs<K>): EventReturn<K> | undefined {
    for (const callback of this.hooksOf(name)) {
      const result = callback(...args)
      if (result !== null && result !== false && result !== undefined) return result
    }
    return undefined
  }

  /** Await listeners one at a time; the first non-null/false/undefined result wins. */
  async serial<K extends keyof Events>(name: K, ...args: EventArgs<K>): Promise<Awaited<EventReturn<K>> | undefined> {
    for (const callback of this.hooksOf(name)) {
      const result = await callback(...args)
      if (result !== null && result !== false && result !== undefined) return result
    }
    return undefined
  }

  /**
   * Around-middleware. The LAST argument the caller passes is the innermost
   * default producer. Each listener receives (...args, next); calling next()
   * delegates inward, returning without next() short-circuits the chain.
   */
  waterfall<K extends keyof Events>(name: K, ...args: EventArgs<K>): EventReturn<K> {
    const queue = this.hooksOf(name)
    const list: unknown[] = [...args]
    const inner = list.pop() as AnyFn
    const next = (): unknown => {
      const callback = queue.shift() ?? inner
      return callback(...list)
    }
    list.push(next)
    return next() as EventReturn<K>
  }

  /** Diagnostics: plugins still waiting for services, with what they miss. */
  pendingNames(): string[] {
    return this.registry.pending
      .filter((fiber) => fiber.state === 'pending')
      .map((fiber) => `${fiber.name} (missing: ${fiber.missing().join(', ')})`)
  }
}

/**
 * Base class for service providers: constructing one publishes it under
 * `name`. Register service classes with ctx.plugin(MyService) so dependents
 * only activate after the constructor (including field initializers) ran.
 */
export class Service {
  constructor(protected ctx: Context, readonly name: string) {
    ctx.provide(name, this)
  }
}

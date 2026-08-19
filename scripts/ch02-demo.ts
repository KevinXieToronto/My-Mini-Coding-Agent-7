import { Context, Service } from '@mini-dsh/cordis'

// Declaration merging: this file (later: each package) teaches the compiler
// what lives on Context and which events exist.
declare module '@mini-dsh/cordis' {
  interface Context {
    counter: Counter
  }
  interface Events {
    'greet'(message: string): void
    'transform'(text: string, next: () => string): string
  }
}

// A service: constructing it publishes it as ctx.counter.
class Counter extends Service {
  private value = 0
  constructor(ctx: Context) {
    super(ctx, 'counter')
  }
  next(): number {
    this.value += 1
    return this.value
  }
}

// A function plugin with a dependency: stays pending until 'counter' exists.
// (Function.name is read-only, so the plugin name comes from the function
// itself; only `inject` is attached as metadata.)
const greeter = Object.assign(
  function greeter(ctx: Context) {
    ctx.on('greet', (message) => {
      console.log(`[greeter] ${message} #${ctx.counter.next()}`)
    })
  },
  { inject: ['counter'] as const },
)

const root = new Context()

// 1. Dependency-ordered activation: greeter first, Counter second.
root.plugin(greeter)
console.log('pending:', root.pendingNames())
root.plugin(Counter)
console.log('pending:', root.pendingNames())
root.emit('greet', 'hello')
root.emit('greet', 'hello again')

// 2. Waterfall: listeners wrap the default producer.
root.plugin({
  name: 'shouter',
  apply: (ctx) => {
    ctx.on('transform', (_text, next) => next().toUpperCase())
  },
})
const transformed = root.waterfall('transform', 'plugins all the way down', () => 'plugins all the way down')
console.log('transform:', transformed)

// 3. Reversible effects: disposing a plugin undoes its listeners and effects.
const fiber = root.plugin((ctx: Context) => {
  ctx.effect(() => {
    console.log('[effect] resource acquired')
    return () => console.log('[effect] resource released')
  })
  ctx.on('greet', () => console.log('[temp] heard a greeting too'))
})
root.emit('greet', 'before dispose')
fiber.dispose()
root.emit('greet', 'after dispose')

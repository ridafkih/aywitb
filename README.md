# aywitb

This is the anything library, it does anything.

```sh
bun add aywitb
```

Add the plugin to your `bunfig.toml` so generic types can be resolved at runtime:

```toml
preload = ["aywitb/plugin"]
```

```ts
import { aywitb } from "aywitb";

type WebSocketServer = {
  startServer({ port }: { port: number }): void;
  on(eventName: "verbose-log", handler: (event: unknown) => void): void;
}

const server = await aywitb<WebSocketServer>(`
  a websocket server that works with url-based rooms
  join by connecting to ws://.../room/{string[6]}
  rooms are upserted and messages fan to all clients in the room
`, { verbose: true });

server.on("verbose-log", console.log);
server.startServer({ port: 3000 });
```

## Questions?

### What does this actually do?

It takes the prompt you provide to the `aywitb` function, and runs it through a small, naïve and improvised pseudo-harness instructing the LLM to build the implementation.

Implementation is cached locally, if you change the prompt or generic - it will cache miss.

### How do I run this?

With Bun, as a plugin component exists that pulls and resolves the generic type you pass into the `aywitb` function so inference can be ran with the type signature in the context.

### When should I use this?

You shouldn't.

### Is it safe to use?

No. If you do play with it, sandbox it.

### Why did you make this?

I think I have an addiction to making things.

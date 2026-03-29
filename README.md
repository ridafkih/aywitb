# aywitb

This is the anything library, it does anything.

```ts
import { aywitb } from "aywitb";

await aywitb<{ serve: (port: number) => void }>(`
  a websocket that is hosted on port 3000
  it should let users join a room using a url
  any messages shared with the server are sent to all
  clients in the room
`);
````

## Questions?

### When should I use this?

You shouldn't.

### Is it safe to use?

No, probably not. If you do play with it, sandbox it.

### Why did you make this?

I have an addiction to making things.

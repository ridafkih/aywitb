import { aywitb } from "../src/index.ts";

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

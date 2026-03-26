import { aywitb } from "../index.ts";

type WebSocketServer = {
  startServer({ port }: { port: number }): void;
  on(eventName: "verbose-log", handler: (event: unknown) => void): void;
}

const server = await aywitb<WebSocketServer>(`
  a websocket library that is hosted at the provided port
  it should let users join a room using a url /room/{string[6]}
  any messages shared with the server are sent to all
  clients in the room, rooms are upserted on join
`, { verbose: true });

server.on("verbose-log", console.log);
server.startServer({ port: 3000 });

import { join } from "node:path";
import { aywitb } from "../index.ts";

const server = await Bun.file(join(import.meta.dir, "websocket-chat-server.ts")).text();

type ClientSignature = {
  on(event: "room-joined", handle: (roomId: string) => void): void;
  join(baseUrl: string, room: string): void;
  send(message: string): void;
}

const client = await aywitb<ClientSignature>(`
  the client counterpart to the server generated from ${server}
`, { verbose: true })

client.on("room-joined", (id) => {
  console.log("joined", id);
  setInterval(() => client.send(JSON.stringify({ method: "ping" })), 1000);
});

client.join("localhost:3000", "ABC123")

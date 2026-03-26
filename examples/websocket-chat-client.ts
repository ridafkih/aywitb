import { join } from "node:path";
import { aywitb } from "../index.ts";
import { randomUUIDv7 } from "bun";

const server = await Bun.file(join(import.meta.dir, "websocket-chat-server.ts")).text();

console.log("server code at", server);

type ClientSignature = {
  waitForServer(baseUrl: string): Promise<void>;
  joinRoom(baseUrl: string, room: string): void;
  queueMessageForSend(message: string): void;
  on(event: "joined-room", handle: (roomId: string) => void): void;
}

const client = await aywitb<ClientSignature>(`
  a websocket client that can connect to the
  signature defined in the ${server}
`, { verbose: true })

client.on("joined-room", (roomId) => {
  console.log('joined room', roomId)

  setInterval(() => {
    client.queueMessageForSend(JSON.stringify({ uuid: randomUUIDv7() }));
  }, 1000);
})

console.log("waiting for server");
await client.waitForServer("http://localhost:3000/")
console.log("server found");
client.joinRoom("http://localhost:3000/", "ABC123")

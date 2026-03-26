import { entry } from "../index.ts";

await entry(`
  a REST API for a todo list hosted on port 3000
  it should support CRUD operations:
  - POST /todos to create a todo with a title
  - GET /todos to list all todos
  - PATCH /todos/:id to toggle a todo's completed status
  - DELETE /todos/:id to remove a todo
  store todos in memory
`);

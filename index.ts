import { Plugin } from "@opencode/plugin";
import { registerTodoTools } from "./src/tool";

// OpenCode v2 server plugin definition
export default {
  id: "opencode.tools.modern.todos",
  server: registerTodoTools,
  setup: registerTodoTools,
};

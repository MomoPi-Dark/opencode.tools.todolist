import { Plugin } from "@opencode/plugin";
import { registerTodoTools } from "./src/tool";

export default Plugin.define({
  id: "opencode.tools.modern.todos",
  setup: registerTodoTools,
});

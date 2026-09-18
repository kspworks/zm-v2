// Lets CLI scripts import server modules: "server-only" throws outside a
// react-server bundle, so resolve it to an empty module here.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }

    return next(specifier, context);
  },
});

// Runtime types are generated for the deployed compatibility date in worker-runtime.d.ts.
// D1 is optional: this Site currently has no database binding configured.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}

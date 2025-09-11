import { buildApp } from "./app";
import { loadEnv } from "@config/env";

const env = loadEnv();
const app = await buildApp();

app.listen({ port: env.PORT, host: env.HOST }).then(() => {
  app.log.info(`HTTP listening on http://${env.HOST}:${env.PORT}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
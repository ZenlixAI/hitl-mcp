import { createRuntime } from './src/server/create-server';

async function main() {
  const runtime = await createRuntime();
  runtime.server.listen(runtime.config.http.port);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

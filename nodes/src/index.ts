import { ConfigError, USAGE, loadConfig } from "./config";

async function main(): Promise<void> {
  const loaded = await loadConfig();
  if (loaded === null) {
    console.log(USAGE);
    return;
  }

  const { config, server } = loaded;
  console.log("Loaded configuration:", config);

  // Nothing is served yet; release the port on Ctrl+C.
  process.once("SIGINT", () => server.close());
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`Error: ${err.message}\n\n${USAGE}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

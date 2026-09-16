// Test-only preload for the real Pi CLI. Production always uses the Nebius URL.
let originalFetch = globalThis.fetch;
const routedFetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://api.tokenfactory.nebius.com") {
    throw new Error(`Unexpected network destination in isolated test: ${url.origin}`);
  }
  const target = new URL(process.env.PI_NEBIUS_TEST_SERVER);
  url.protocol = target.protocol;
  url.host = target.host;
  return originalFetch(input instanceof Request ? new Request(url, input) : url, init);
};
// Pi installs undici.fetch at startup. Keep routing after that installation too.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => routedFetch,
  set: (fetcher) => {
    originalFetch = fetcher;
  },
});

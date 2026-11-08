// Test-only preload. Redirect only the external iLink boundary; the packaged
// Runtime, authenticated panel, Loader, Agent factory and Session stay real.
const original = globalThis.fetch;
if (process.env.PA24_TEST_WEIXIN_URL) globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  return original(url.hostname.endsWith('.weixin.qq.com') && url.pathname.startsWith('/ilink/bot/')
    ? `${process.env.PA24_TEST_WEIXIN_URL}${url.pathname}${url.search}` : input, options);
};

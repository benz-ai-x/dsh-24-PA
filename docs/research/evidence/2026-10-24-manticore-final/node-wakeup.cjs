// Test-process workaround for delayed native SQLite backup completion on Node 26.4.
setInterval(() => {}, 20).unref();

// src/test/setupTests.ts
if (typeof global !== "undefined" && typeof (global as any).localStorage === "undefined") {
  (global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
}

if (typeof global !== "undefined") {
  (global as any).IS_TEST = true;
}

if (typeof process !== "undefined") {
  process.on("unhandledRejection", (reason) => {
    // Suppress network/mock rejections during test runs
  });
}

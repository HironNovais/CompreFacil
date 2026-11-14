import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./web/tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: process.env.DEMO_BASE_URL || "http://127.0.0.1:8088",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1040 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});

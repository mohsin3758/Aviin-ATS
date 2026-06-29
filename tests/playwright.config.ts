process.env.TENANT_ID = process.env.TENANT_ID || 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  retries: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    baseURL: 'http://localhost:3001',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});

import '@utils/env'
import '@utils/tracer'
import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import AuthRoute from '@routes/auth.route';
import { logger } from '@utils/logger';

// On Node >= 15 an unhandled rejection becomes an uncaught exception, and @tribeplatform/node-logger's
// exception handler then exits the process. Log it instead: one failed Discord or Bettermode call must not
// take down webhooks for every community.
process.on('unhandledRejection', reason => {
  logger.error(reason instanceof Error ? reason : new Error(`Unhandled rejection: ${String(reason)}`));
});

const app = new App([new WebhookRoute(), new HealthRoute(), new AuthRoute()]);

app.listen();

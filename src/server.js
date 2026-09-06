import http from "http";
import app from "./app.js";
import { env } from "./config/env.config.js";
import logger from "./config/logger.config.js";
import prisma from "./config/db.config.js";
import redis from "./config/redis.config.js";
import { initSocket } from "./config/socket.config.js";
import { startFollowupReminderJob } from "./jobs/followupReminder.job.js";

const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info("✅ PostgreSQL (Supabase) connected via Prisma");

    const httpServer = http.createServer(app);

    initSocket(httpServer, env.CLIENT_URL);
    logger.info("✅ Socket.io initialized");

    startFollowupReminderJob();
    logger.info("✅ Follow-up reminder job scheduled (daily 8:00 AM)");

    httpServer.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT} [${env.NODE_ENV}]`);
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      httpServer.close(async () => {
        await prisma.$disconnect();
        redis.disconnect();
        logger.info("Server shut down complete.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error({ error }, "❌ Failed to start server");
    process.exit(1);
  }
};

startServer();
import { createClient } from "redis";
import logger from "./logger.config.js"; // 🌟 লগার ইমপোর্ট করা হলো

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

// 🌟 console.log/error এর বদলে logger ব্যবহার করা হলো
redisClient.on("error", (err) => logger.error({ err }, "Redis Client Error"));
redisClient.on("connect", () => logger.info("Redis connected successfully"));

// Auto-connect on startup
(async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
})();

export default redisClient;
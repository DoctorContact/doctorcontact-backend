import axios from "axios";
import prisma from "../config/db.config.js";
import redisClient from "../config/redis.config.js";

// In-memory fallback sets in case DB or Redis is temporarily disconnected
const memoryUserTokens = new Map(); // userId -> Set of push tokens
const memoryAllTokens = new Set();  // Set of all registered push tokens

const REDIS_USER_PREFIX = "push_token:user:";
const REDIS_ALL_KEY = "push_tokens:all";

/**
 * Validates if string matches Expo Push Token format
 */
export const isValidExpoPushToken = (token) => {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken") || token.startsWith("ExpoPushToken"))
  );
};

/**
 * Mask token to prevent sensitive data leaks in logs
 */
export const maskToken = (token) => {
  if (!token || typeof token !== "string") return "***";
  if (token.length < 15) return "***";
  return `${token.slice(0, 15)}...${token.slice(-4)}`;
};

/**
 * Save / upsert an Expo Push Token for a user (or general device for broadcast announcements).
 * Persists primarily into PostgreSQL via Prisma, with in-memory & optional Redis caching.
 */
export const savePushToken = async (
  pushToken,
  userId = null,
  { platform = "android", deviceId = null } = {}
) => {
  if (!pushToken || typeof pushToken !== "string") return;
  const token = pushToken.trim();
  if (!isValidExpoPushToken(token)) {
    console.warn("[Push] Ignored invalid Expo token format:", maskToken(token));
    return;
  }

  // 1. In-memory cache
  memoryAllTokens.add(token);
  if (userId) {
    if (!memoryUserTokens.has(userId)) {
      memoryUserTokens.set(userId, new Set());
    }
    memoryUserTokens.get(userId).add(token);
  }

  // Check if token belonged to a previous user for Redis cleanup
  let previousUserId = null;
  try {
    const existing = await prisma.pushToken.findUnique({
      where: { token },
      select: { userId: true },
    });
    if (existing?.userId) previousUserId = existing.userId;
  } catch {}

  // 2. Persistent storage in PostgreSQL via Prisma
  try {
    await prisma.pushToken.upsert({
      where: { token },
      update: {
        userId: userId || undefined,
        platform: platform || "android",
        deviceId: deviceId || undefined,
        updatedAt: new Date(),
      },
      create: {
        token,
        userId: userId || null,
        platform: platform || "android",
        deviceId: deviceId || null,
      },
    });
    console.log(`[Push] Token persisted to DB for user=${userId || "anonymous"} platform=${platform}`);
  } catch (dbErr) {
    console.warn("[Push] DB push token upsert warning (falling back to memory):", dbErr.message);
  }

  // 3. Optional Redis cache fallback
  try {
    if (redisClient?.isOpen) {
      await redisClient.sAdd(REDIS_ALL_KEY, token);
      if (previousUserId && previousUserId !== userId) {
        await redisClient.sRem(`${REDIS_USER_PREFIX}${previousUserId}`, token);
      }
      if (userId) {
        await redisClient.sAdd(`${REDIS_USER_PREFIX}${userId}`, token);
      }
    }
  } catch (redisErr) {
    console.warn("[Push] Redis push token storage warning:", redisErr.message);
  }
};

/**
 * Remove an invalid or unregistered push token across DB, memory, and Redis
 */
export const removePushToken = async (pushToken, userId = null) => {
  if (!pushToken || typeof pushToken !== "string") return;
  const token = pushToken.trim();

  let targetUserId = userId;
  if (!targetUserId) {
    try {
      const existing = await prisma.pushToken.findUnique({
        where: { token },
        select: { userId: true },
      });
      if (existing?.userId) targetUserId = existing.userId;
    } catch {}
  }

  // 1. Memory cleanup
  memoryAllTokens.delete(token);
  for (const [uid, tokenSet] of memoryUserTokens.entries()) {
    if (tokenSet.has(token)) {
      tokenSet.delete(token);
      if (tokenSet.size === 0) memoryUserTokens.delete(uid);
    }
  }

  // 2. DB cleanup
  try {
    await prisma.pushToken.deleteMany({
      where: { token },
    });
    console.log(`[Push] Removed inactive token from DB: ${maskToken(token)}`);
  } catch (dbErr) {
    console.warn("[Push] DB remove token warning:", dbErr.message);
  }

  // 3. Redis cleanup
  try {
    if (redisClient?.isOpen) {
      await redisClient.sRem(REDIS_ALL_KEY, token);
      if (targetUserId) {
        await redisClient.sRem(`${REDIS_USER_PREFIX}${targetUserId}`, token);
      }
    }
  } catch (redisErr) {
    console.warn("[Push] Redis remove token warning:", redisErr.message);
  }
};

/**
 * Get registered push tokens for a specific user ID
 */
export const getUserPushTokens = async (userId) => {
  if (!userId) return [];
  const tokens = new Set();

  // 1. Check in-memory store
  if (memoryUserTokens.has(userId)) {
    memoryUserTokens.get(userId).forEach((t) => tokens.add(t));
  }

  // 2. Query PostgreSQL
  try {
    const dbRecords = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    dbRecords.forEach((r) => {
      if (isValidExpoPushToken(r.token)) tokens.add(r.token);
    });
  } catch (dbErr) {
    console.warn("[Push] DB getUserPushTokens warning:", dbErr.message);
  }

  // 3. Optional Redis check
  try {
    if (redisClient?.isOpen) {
      const redisTokens = await redisClient.sMembers(`${REDIS_USER_PREFIX}${userId}`);
      if (Array.isArray(redisTokens)) {
        redisTokens.forEach((t) => {
          if (isValidExpoPushToken(t)) tokens.add(t);
        });
      }
    }
  } catch (redisErr) {
    console.warn("[Push] Redis token retrieval warning:", redisErr.message);
  }

  return Array.from(tokens);
};

/**
 * Get all registered push tokens across the platform (for global announcements)
 */
export const getAllPushTokens = async () => {
  const tokens = new Set();

  // 1. Memory store
  memoryAllTokens.forEach((t) => tokens.add(t));

  // 2. Query PostgreSQL
  try {
    const dbRecords = await prisma.pushToken.findMany({
      select: { token: true },
    });
    dbRecords.forEach((r) => {
      if (isValidExpoPushToken(r.token)) tokens.add(r.token);
    });
  } catch (dbErr) {
    console.warn("[Push] DB getAllPushTokens warning:", dbErr.message);
  }

  // 3. Optional Redis check
  try {
    if (redisClient?.isOpen) {
      const redisTokens = await redisClient.sMembers(REDIS_ALL_KEY);
      if (Array.isArray(redisTokens)) {
        redisTokens.forEach((t) => {
          if (isValidExpoPushToken(t)) tokens.add(t);
        });
      }
    }
  } catch (redisErr) {
    console.warn("[Push] Redis all tokens retrieval warning:", redisErr.message);
  }

  return Array.from(tokens);
};

/**
 * Verifies receipts from Expo push backend to check delivery state and clean up dead devices
 */
export const checkPushReceipts = async (receiptPairs = []) => {
  if (!receiptPairs || receiptPairs.length === 0) return;

  const ticketIds = receiptPairs.map((p) => p.id).filter(Boolean);
  if (ticketIds.length === 0) return;

  try {
    const headers = {
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const res = await axios.post(
      "https://exp.host/--/api/v2/push/getReceipts",
      { ids: ticketIds },
      { headers, timeout: 10000 }
    );

    const receipts = res.data?.data || {};
    for (const pair of receiptPairs) {
      const receipt = receipts[pair.id];
      if (receipt) {
        if (receipt.status === "error") {
          console.warn(
            `[Push] Receipt error for ticket ${pair.id}: ${receipt.message} (${receipt.details?.error})`
          );
          if (receipt.details?.error === "DeviceNotRegistered") {
            console.log(`[Push] Device not registered in receipt. Removing dead token: ${pair.token}`);
            await removePushToken(pair.token);
          }
        } else if (receipt.status === "ok") {
          // Delivered successfully
        }
      }
    }
  } catch (err) {
    console.warn("[Push] Failed to check push receipts:", err?.response?.data || err.message);
  }
};

// In-memory sliding window cache to prevent duplicate remote push dispatches
const recentDispatches = new Map(); // key -> timestamp

/**
 * Send an Expo Push Notification to one or multiple push tokens.
 * Automatically chunks tokens into batches of 100 as required by the Expo Push API.
 * Wakes up closed / killed Android & iOS apps via Google FCM / Apple APNs.
 */
export const sendExpoPushNotification = async (pushTokens, { title, message, data = {} }) => {
  if (!pushTokens) return;
  const rawList = Array.isArray(pushTokens) ? pushTokens : [pushTokens];
  const tokenList = Array.from(new Set(rawList.filter(isValidExpoPushToken)));

  if (tokenList.length === 0) return;

  // Deduplicate rapid repeat calls for the same notification or announcement event
  const dedupKey = data?.notificationId
    ? `notif_${data.notificationId}`
    : data?.announcementId
    ? `ann_${data.announcementId}`
    : null;

  if (dedupKey) {
    const now = Date.now();
    const lastSent = recentDispatches.get(dedupKey);
    if (lastSent && now - lastSent < 10000) {
      console.log(`[Push] Deduplicated repeat remote push send for key: ${dedupKey}`);
      return;
    }
    recentDispatches.set(dedupKey, now);

    // Bounded cleanup
    if (recentDispatches.size > 1000) {
      for (const [k, time] of recentDispatches.entries()) {
        if (now - time > 60000) recentDispatches.delete(k);
      }
    }
  }

  // Chunk array into max 100 per request
  const chunks = [];
  for (let i = 0; i < tokenList.length; i += 100) {
    chunks.push(tokenList.slice(i, i + 100));
  }

  const allTicketsToCheck = [];

  for (const chunk of chunks) {
    const messages = chunk.map((to) => ({
      to,
      sound: "default",
      title: title || "Doctor Contact",
      body: message || "",
      data: {
        ...data,
        receivedAt: new Date().toISOString(),
      },
      priority: "high",
      channelId: "default",
      _displayInForeground: true,
    }));

    try {
      const headers = {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      };

      if (process.env.EXPO_ACCESS_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
      }

      const response = await axios.post("https://exp.host/--/api/v2/push/send", messages, {
        headers,
        timeout: 10000,
      });

      const tickets = response.data?.data || [];
      tickets.forEach((ticket, idx) => {
        const token = chunk[idx];
        if (ticket.status === "ok") {
          if (ticket.id) {
            allTicketsToCheck.push({ id: ticket.id, token });
          }
        } else if (ticket.status === "error") {
          console.warn(
            `[Push] Ticket error for token ${maskToken(token)}: ${ticket.message} (${ticket.details?.error})`
          );
          if (ticket.details?.error === "DeviceNotRegistered") {
            console.log(`[Push] Token ${maskToken(token)} is no longer registered. Removing...`);
            removePushToken(token).catch(() => {});
          }
        }
      });
    } catch (err) {
      console.warn(
        "[Push] Expo push notification delivery notice:",
        err?.response?.data || err.message
      );
    }
  }

  // Schedule receipt verification in background after 25 seconds
  if (allTicketsToCheck.length > 0) {
    setTimeout(() => {
      checkPushReceipts(allTicketsToCheck).catch((err) => {
        console.warn("[Push] Error during receipt checking:", err.message);
      });
    }, 25000);
  }
};
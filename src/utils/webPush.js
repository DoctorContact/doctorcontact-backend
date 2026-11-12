import { sendNotification } from "web-push";
import prisma from "../config/db.config.js";

let vapidDetails = null;
let checked = false;

const getVapidDetails = () => {
  if (checked) return vapidDetails;
  checked = true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[WebPush] VAPID keys missing in .env - browser push is disabled");
    return null;
  }
  vapidDetails = {
    subject: process.env.VAPID_SUBJECT || "mailto:doctorcontact620@gmail.com",
    publicKey,
    privateKey,
  };
  return vapidDetails;
};

export const getWebPushPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

const normalizeSubscription = (subscription) => {
  if (!subscription || typeof subscription.endpoint !== "string") return null;
  if (!subscription.endpoint.startsWith("https://")) return null;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;
  if (!p256dh || !auth) return null;
  return JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh, auth } });
};

export const saveWebPushSubscription = async (userId, subscription) => {
  const token = normalizeSubscription(subscription);
  if (!userId || !token) return false;

  await prisma.pushToken.upsert({
    where: { token },
    update: { userId, platform: "web" },
    create: { token, userId, platform: "web" },
  });

  await prisma.pushToken.deleteMany({
    where: {
      platform: "web",
      token: { contains: subscription.endpoint },
      NOT: { token },
    },
  });

  return true;
};

export const removeWebPushSubscription = async (userId, endpoint) => {
  if (!userId || typeof endpoint !== "string" || !endpoint) return;
  await prisma.pushToken.deleteMany({
    where: { platform: "web", userId, token: { contains: endpoint } },
  });
};

const sendToRow = async (row, payload) => {
  let subscription;
  try {
    subscription = JSON.parse(row.token);
  } catch {
    await prisma.pushToken.deleteMany({ where: { id: row.id } }).catch(() => {});
    return;
  }

  try {
    await sendNotification(subscription, payload, {
      vapidDetails: getVapidDetails(),
      TTL: 3600,
      urgency: "high",
    });
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await prisma.pushToken.deleteMany({ where: { id: row.id } }).catch(() => {});
    } else {
      console.warn("[WebPush] send failed:", err?.statusCode || err?.message);
    }
  }
};

export const sendWebPushToUser = async (userId, { title, body, url, tag }) => {
  if (!userId || !getVapidDetails()) return;
  try {
    const rows = await prisma.pushToken.findMany({
      where: { userId, platform: "web" },
      select: { id: true, token: true },
    });
    if (rows.length === 0) return;
    const payload = JSON.stringify({ title, body, url: url || "/", tag });
    await Promise.allSettled(rows.map((row) => sendToRow(row, payload)));
  } catch (err) {
    console.warn("[WebPush] sendWebPushToUser error:", err.message);
  }
};

export const sendWebPushToAll = async ({ title, body, url, tag }, { excludeUserId } = {}) => {
  if (!getVapidDetails()) return;
  try {
    const payload = JSON.stringify({ title, body, url: url || "/", tag });
    let cursor = null;
    while (true) {
      const rows = await prisma.pushToken.findMany({
        where: {
          platform: "web",
          ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        select: { id: true, token: true },
        orderBy: { id: "asc" },
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      await Promise.allSettled(rows.map((row) => sendToRow(row, payload)));
      cursor = rows[rows.length - 1].id;
      if (rows.length < 200) break;
    }
  } catch (err) {
    console.warn("[WebPush] sendWebPushToAll error:", err.message);
  }
};

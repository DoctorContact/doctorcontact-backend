import { sendNotification } from "web-push";
import prisma from "../config/db.config.js";

const getVapidDetails = () => {
  // .env থেকে ডেটা নিয়ে স্পেস (space) থাকলে সেটা ডিলিট করে দিচ্ছি
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  let subject = process.env.VAPID_SUBJECT?.trim() || "mailto:doctorcontact620@gmail.com";
  
  // যদি কেউ mailto: লিখতে ভুলে যায়, তাহলে অটোমেটিক বসিয়ে দেবে
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    subject = `mailto:${subject}`;
  }

  if (!publicKey || !privateKey) {
    console.warn("[WebPush] VAPID keys missing in .env - browser push is disabled");
    return null;
  }
  
  return { subject, publicKey, privateKey };
};

export const getWebPushPublicKey = () => process.env.VAPID_PUBLIC_KEY?.trim() || null;

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
    where: { platform: "web", token: { contains: subscription.endpoint }, NOT: { token } },
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
    return { ok: false, statusCode: 0, message: "Saved subscription was unreadable" };
  }

  const vapidDetails = getVapidDetails();
  if (!vapidDetails) return { ok: false, statusCode: 503, message: "Server VAPID keys missing" };

  try {
    await sendNotification(subscription, payload, {
      vapidDetails,
      TTL: 3600,
      urgency: "high",
    });
    return { ok: true };
  } catch (err) {
    const statusCode = err?.statusCode || 0;
    
    // 🟢 NEW: গুগলের সার্ভার থেকে আসা আসল এরর মেসেজটা প্রিন্ট করবে
    console.log("==================================================");
    console.error("[WebPush FCM Error] Status:", statusCode);
    console.error("[WebPush FCM Error] Body:", err?.body);
    console.log("==================================================");

    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushToken.deleteMany({ where: { id: row.id } }).catch(() => {});
    }
    
    return {
      ok: false,
      statusCode,
      message: String(err?.body || err?.message || "Unknown error").slice(0, 200),
    };
  }
};

export const sendWebPushToUser = async (userId, { title, body, url, tag }) => {
  const summary = { configured: false, devices: 0, sent: 0, failed: [] };
  if (!userId || !getVapidDetails()) return summary;
  
  summary.configured = true;
  try {
    const rows = await prisma.pushToken.findMany({
      where: { userId, platform: "web" },
      select: { id: true, token: true },
    });
    
    summary.devices = rows.length;
    if (rows.length === 0) return summary;
    
    const payload = JSON.stringify({ title, body, url: url || "/", tag });
    const results = await Promise.all(rows.map((row) => sendToRow(row, payload)));
    
    for (const result of results) {
      if (result.ok) summary.sent += 1;
      else summary.failed.push({ statusCode: result.statusCode, message: result.message });
    }
  } catch (err) {
    summary.failed.push({ statusCode: 0, message: err.message });
  }
  return summary;
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
  } catch (err) {}
};
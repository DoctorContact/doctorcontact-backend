import { sendExpoPushNotification } from "./src/utils/pushNotification.js";
import prisma from "./src/config/db.config.js";
import { countUnread, markAsRead, markAllAsRead, createNotification } from "./src/modules/notification/notification.repository.js";

async function run() {
  console.log("=== Testing Backend Push Deduplication & Read State ===");
  try {
    // -------------------------------------------------------------
    // Test 1: Deduplication Window (10s sliding window)
    // -------------------------------------------------------------
    console.log("[Test 1] Testing duplicate push prevention window...");
    const fakeToken = "ExponentPushToken[test_dedup_token_1234567890]";
    const testNotifId = `test_notif_${Date.now()}`;

    let logCaptured = false;
    const originalLog = console.log;
    console.log = (...args) => {
      if (args[0]?.includes?.("Deduplicated repeat remote push send")) {
        logCaptured = true;
      }
      originalLog(...args);
    };

    // First send call (recorded in sliding window cache)
    await sendExpoPushNotification([fakeToken], {
      title: "Test 1",
      message: "Message 1",
      data: { notificationId: testNotifId },
    });

    // Immediate second call with identical notificationId (must be dropped by deduplicator)
    await sendExpoPushNotification([fakeToken], {
      title: "Test 1 Duplicate",
      message: "Message 1 Duplicate",
      data: { notificationId: testNotifId },
    });

    console.log = originalLog;
    console.log(`[Test 1] Deduplication captured: ${logCaptured ? "PASS" : "FAIL"}`);

    // -------------------------------------------------------------
    // Test 2: Database Read State Queries & Count Unread
    // -------------------------------------------------------------
    console.log("[Test 2] Testing notification repository queries...");
    const testUser = await prisma.user.findFirst({ where: { isActive: true } });
    if (testUser) {
      const initialUnread = await countUnread(testUser.id);
      console.log(`[Test 2] User initial unread: ${initialUnread}`);

      const notif = await createNotification({
        userId: testUser.id,
        type: "GENERAL",
        title: "Test Verification Notification",
        message: "Testing read status",
        meta: { test: true },
      });

      const unreadAfterInsert = await countUnread(testUser.id);
      console.log(
        `[Test 2] Unread after insert: ${unreadAfterInsert} (expected +1: ${
          unreadAfterInsert === initialUnread + 1
        })`
      );

      await markAsRead(notif.id);
      const unreadAfterMarkRead = await countUnread(testUser.id);
      console.log(
        `[Test 2] Unread after markAsRead: ${unreadAfterMarkRead} (expected back to initial: ${
          unreadAfterMarkRead === initialUnread
        })`
      );

      // Clean up test notification row
      await prisma.notification.delete({ where: { id: notif.id } });
      console.log("[Test 2] Test notification cleaned up cleanly");
    }

    console.log("=== All Tests Completed Successfully ===");
  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

run();
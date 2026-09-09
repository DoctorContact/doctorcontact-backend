import admin from "firebase-admin";

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    // 1. Remove surrounding quotes jodi thake
    privateKey = privateKey.replace(/^["']|["']$/g, "");
    // 2. String '\n' ke actual line break-e convert kora
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("⚠️ Firebase credentials missing in .env");
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      console.log("🔥 Firebase Admin initialized successfully!");
    } catch (error) {
      console.error("❌ Firebase Admin initialization failed:", error.message);
    }
  }
}

export const verifyFirebasePhoneToken = async (idToken) => {
  if (!admin.apps.length) {
    throw new Error("Firebase Admin is not configured");
  }

  const decoded = await admin.auth().verifyIdToken(idToken);

  if (!decoded.phone_number) {
    throw new Error("This Firebase token has no verified phone number");
  }

  return decoded.phone_number;
};

export default admin;
import admin from "firebase-admin";

// Firebase Admin is used ONLY to verify ID tokens that the frontend gets
// back from Firebase Phone Auth (client SDK). The backend never generates
// or stores OTPs itself — Firebase handles sending/verifying the SMS code.
//
// Required env vars (from your Firebase project's service account JSON,
// Project Settings -> Service Accounts -> Generate new private key):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (keep the \n escapes if pasted as one line)

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    // Don't crash the whole server on boot if this isn't configured yet —
    // just fail loudly the first time someone actually calls the phone-auth
    // endpoint, so the rest of the API keeps working.
    console.warn(
      "[firebase.config] Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — phone OTP login will fail until these are set."
    );
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
}

/**
 * Verifies a Firebase ID token (obtained on the frontend after a successful
 * Phone Auth OTP confirmation) and returns the verified phone number.
 * Throws if the token is invalid/expired or has no phone_number claim.
 */
export const verifyFirebasePhoneToken = async (idToken) => {
  if (!admin.apps.length) {
    throw new Error("Firebase Admin is not configured (missing service account env vars)");
  }

  const decoded = await admin.auth().verifyIdToken(idToken);

  if (!decoded.phone_number) {
    throw new Error("This Firebase token has no verified phone number");
  }

  return decoded.phone_number; // E.164 format, e.g. +919876543210
};

export default admin;

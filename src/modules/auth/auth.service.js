import ApiError from "../../utils/apiError.js";
import redis from "../../config/redis.config.js";
import { normalizePhone } from "../../utils/phoneNormalizer.js";
import { verifyFirebasePhoneToken } from "../../config/firebase.config.js";
import { findPatientByPhone } from "../patient/patient.repository.js";
import {
  findUserByEmail,
  findUserById,
  findUserByPhone,
  createUserWithProfile,
  createPhoneVerifiedPatient,
  updateUserPassword,
  markUserVerified,
  updateRefreshToken,
  clearRefreshToken,
} from "./auth.repository.js";
import { hashPassword, comparePassword, generateOtp, hashToken } from "./auth.helper.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../../utils/tokenGenerator.js";
import { OTP_EXPIRY_SECONDS, OTP_PREFIX } from "./auth.constants.js";
import { sendEmail } from "../../utils/emailService.js";

export const registerUser = async ({ name, email, password, phone, dob }) => {
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    throw new ApiError(409, "User with this email already exists");
  }

  const normalizedPhone = normalizePhone(phone);
  const hashedPassword = await hashPassword(password);
  const role = "PATIENT"; 

  // STEP 9: Check if a Guest Patient record already exists with this phone number
  let guestPatientId = null;
  if (normalizedPhone) {
    const existingPatient = await findPatientByPhone(normalizedPhone);
    
    // If the patient exists but has no userId, it's a Clinic-created Guest. We will link it.
    if (existingPatient && !existingPatient.userId) {
      guestPatientId = existingPatient.id;
    } 
    // If a user already owns this phone number, Prisma's unique constraint on User.phone will catch it.
  }

  // Pass guestPatientId to the repository so it links instead of creating a duplicate
  const user = await createUserWithProfile({
    userData: { name, email, phone: normalizedPhone, role, password: hashedPassword },
    role,
    dob,
    guestPatientId // NEW: Instruction to link
  });

  return sanitizeUser(user);
};

export const loginUser = async ({ email, phone, password }) => {
  const user = email
    ? await findUserByEmail(email)
    : await findUserByPhone(normalizePhone(phone));

  if (!user || !user.password) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Your account has been deactivated");
  }

  const tokens = await issueTokens(user);
  return { user: sanitizeUser(user), ...tokens };
};

// PATIENT ONLY login/signup — one endpoint does both. `idToken` is what the
// frontend gets back from Firebase Phone Auth after the user confirms the
// SMS OTP; we never see or generate the OTP itself, just verify Firebase's
// token to learn the (already-verified) phone number.
export const patientPhoneAuth = async ({ idToken, name }) => {
  const rawPhone = await verifyFirebasePhoneToken(idToken); // throws if invalid/expired
  const phone = normalizePhone(rawPhone);

  let user = await findUserByPhone(phone);

  if (user) {
    if (user.role !== "PATIENT") {
      throw new ApiError(
        409,
        "This phone number is already registered as a different type of account"
      );
    }
    if (!user.isActive) {
      throw new ApiError(403, "Your account has been deactivated");
    }
    if (!user.isVerified) {
      // First time THIS person (not a clinic) is logging in with their own
      // phone — e.g. an account a clinic auto-created when adding them as a
      // walk-in. Firebase just proved they own the number, so verify now.
      user = await markUserVerified(user.id);
    }

    const tokens = await issueTokens(user);
    return { user: sanitizeUser(user), ...tokens, isNewAccount: false };
  }

  // No account at all for this phone yet. Check for a pre-existing, unlinked
  // guest Patient row as a safety net for older data (new guest patients are
  // always created with a User attached already — see patient.repository.js)
  const existingPatient = await findPatientByPhone(phone);
  const guestPatientId = existingPatient && !existingPatient.userId ? existingPatient.id : null;

  if (!name) {
    throw new ApiError(400, "Name is required to create a new account");
  }

  user = await createPhoneVerifiedPatient({ phone, name, guestPatientId });
  const tokens = await issueTokens(user);
  return { user: sanitizeUser(user), ...tokens, isNewAccount: true };
};

export const refreshTokens = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await findUserById(decoded.id);
  if (!user || user.refreshToken !== hashToken(incomingRefreshToken)) {
    throw new ApiError(401, "Refresh token is invalid or has been revoked");
  }

  const tokens = await issueTokens(user);
  return { user: sanitizeUser(user), ...tokens };
};

export const logoutUser = async (userId) => {
  await clearRefreshToken(userId);
};

export const forgotPassword = async (email) => {
  const user = await findUserByEmail(email);
  if (!user) {
    // Don't reveal whether the email exists
    return;
  }

  if (!user.selfRegistered) {
    throw new ApiError(
      403,
      "This account's password can only be reset by your Clinic Admin or Super Admin"
    );
  }

  const otp = generateOtp();
  await redis.set(`${OTP_PREFIX}${email}`, otp, "EX", OTP_EXPIRY_SECONDS);

  await sendEmail({
    to: email,
    subject: "Password Reset OTP",
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
  });
};

export const resetPassword = async ({ email, otp, newPassword }) => {
  const storedOtp = await redis.get(`${OTP_PREFIX}${email}`);
  if (!storedOtp || storedOtp !== otp) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  const user = await findUserByEmail(email);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(user.id, hashedPassword);
  await redis.del(`${OTP_PREFIX}${email}`);
};

// Doctor/Clinic/Receptionist/Admin/Super Admin — phone-based reset. The
// Firebase ID token already proves the person confirmed the SMS OTP for this
// phone, so unlike the email flow there's no separate "request OTP" step:
// verify ownership and reset the password in one call.
export const resetPasswordByPhone = async ({ idToken, newPassword }) => {
  const phone = normalizePhone(await verifyFirebasePhoneToken(idToken));

  const user = await findUserByPhone(phone);
  if (!user) {
    throw new ApiError(404, "No account found with this phone number");
  }

  if (user.role === "PATIENT") {
    throw new ApiError(400, "Patients log in with phone + OTP and don't have a password to reset");
  }

  if (!user.selfRegistered) {
    throw new ApiError(
      403,
      "This account's password can only be reset by your Clinic Admin or Super Admin"
    );
  }

  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(user.id, hashedPassword);
};

// ---- helpers ----

const issueTokens = async (user) => {
  const payload = { id: user.id, role: user.role, email: user.email };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await updateRefreshToken(user.id, hashToken(refreshToken));

  return { accessToken, refreshToken };
};

const sanitizeUser = (user) => {
  const { password, refreshToken, ...safeUser } = user;
  return safeUser;
};
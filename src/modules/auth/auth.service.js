import ApiError from "../../utils/apiError.js";
import redisClient from "../../config/redis.config.js"; // 🟢 Fixed import
import { normalizePhone } from "../../utils/phoneNormalizer.js";
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
import { sendEmail } from "../../utils/emailService.js"
import { verifyFirebasePhoneToken } from "../../config/firebase.config.js";



export const registerUser = async ({ name, email, password, phone, dob }) => {
  const existingUser = await findUserByEmail(email);
  if (existingUser) throw new ApiError(409, "User with this email already exists");

  const normalizedPhone = normalizePhone(phone);
  const hashedPassword = await hashPassword(password);
  const role = "PATIENT"; 

  let guestPatientId = null;
  if (normalizedPhone) {
    const existingPatient = await findPatientByPhone(normalizedPhone);
    if (existingPatient && !existingPatient.userId) {
      guestPatientId = existingPatient.id;
    } 
  }

  const user = await createUserWithProfile({
    userData: { name, email, phone: normalizedPhone, role, password: hashedPassword },
    role, dob, guestPatientId
  });

  return sanitizeUser(user);
};

export const loginUser = async ({ email, phone, password }) => {
  const user = email
    ? await findUserByEmail(email)
    : await findUserByPhone(normalizePhone(phone));

  if (!user || !user.password) throw new ApiError(401, "Invalid credentials");

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) throw new ApiError(401, "Invalid credentials");

  if (!user.isActive) throw new ApiError(403, "Your account has been deactivated");

  const tokens = await issueTokens(user);
  return { user: sanitizeUser(user), ...tokens };
};

// patientPhoneAuth function update koro
export const patientPhoneAuth = async ({ idToken, name }) => {
  // 1. Firebase theke idToken verify kore phone number ber kora
  const rawPhone = await verifyFirebasePhoneToken(idToken); 
  const phone = normalizePhone(rawPhone);

  // 2. Existing user check kora
  let user = await findUserByPhone(phone);

  if (user) {
    if (user.role !== "PATIENT") {
      throw new ApiError(409, "This phone number is already registered as a different type of account");
    }
    if (!user.isActive) throw new ApiError(403, "Your account has been deactivated");
    if (!user.isVerified) user = await markUserVerified(user.id);

    const tokens = await issueTokens(user);
    return { user: sanitizeUser(user), ...tokens, isNewAccount: false };
  }

  // 3. Notun user toiri kora
  const existingPatient = await findPatientByPhone(phone);
  const guestPatientId = existingPatient && !existingPatient.userId ? existingPatient.id : null;

  if (!name) throw new ApiError(400, "Name is required to create a new account");

  user = await createPhoneVerifiedPatient({ phone, name, guestPatientId });
  const tokens = await issueTokens(user);
  return { user: sanitizeUser(user), ...tokens, isNewAccount: true };
};

export const refreshTokens = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) throw new ApiError(401, "Refresh token is required");

  let decoded;
  try { decoded = verifyRefreshToken(incomingRefreshToken); } 
  catch { throw new ApiError(401, "Invalid or expired refresh token"); }

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
  if (!user) return;
  if (!user.selfRegistered) throw new ApiError(403, "Cannot self-reset password");

  const otp = generateOtp();
  // 🟢 Fixed Redis syntax for v4
  await redisClient.setEx(`${OTP_PREFIX}${email}`, OTP_EXPIRY_SECONDS, otp);

  await sendEmail({
    to: email,
    subject: "Password Reset OTP",
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
  });
};

export const resetPassword = async ({ email, otp, newPassword }) => {
  // 🟢 Fixed Redis variable name
  const storedOtp = await redisClient.get(`${OTP_PREFIX}${email}`);
  if (!storedOtp || storedOtp !== otp) throw new ApiError(400, "Invalid or expired OTP");

  const user = await findUserByEmail(email);
  if (!user) throw new ApiError(404, "User not found");

  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(user.id, hashedPassword);
  await redisClient.del(`${OTP_PREFIX}${email}`);
};

export const resetPasswordByPhone = async ({ phone, newPassword }) => {
  const normalizedPhone = normalizePhone(phone);
  const user = await findUserByPhone(normalizedPhone);
  
  if (!user) throw new ApiError(404, "No account found");
  if (user.role === "PATIENT") throw new ApiError(400, "Patients don't have passwords");
  if (!user.selfRegistered) throw new ApiError(403, "Cannot self-reset password");

  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(user.id, hashedPassword);
};

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
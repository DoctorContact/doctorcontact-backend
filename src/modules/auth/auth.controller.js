import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import { COOKIE_OPTIONS } from "./auth.constants.js";
import redisClient from "../../config/redis.config.js";
import { sendOTP } from "./otp.service.js";
import ApiError from "../../utils/apiError.js";
import { generateOtp } from "./auth.helper.js";
import { normalizePhone } from "../../utils/phoneNormalizer.js";

import {
  registerSchema,
  loginSchema,
  patientPhoneAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resetPasswordByPhoneSchema,
} from "./auth.validation.js";

import * as authService from "./auth.service.js";
import { findUserByPhone, updateRefreshToken } from "./auth.repository.js";
import { generateAccessToken, generateRefreshToken } from "../../utils/tokenGenerator.js";
import { hashToken } from "./auth.helper.js";

export const googleCallback = asyncHandler(async (req, res) => {
  const user = req.user;
  const payload = { id: user.id, role: user.role, email: user.email };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await updateRefreshToken(user.id, hashToken(refreshToken));
  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);
  res.redirect(`${process.env.CLIENT_URL}/oauth-success?accessToken=${accessToken}`);
});

export const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const user = await authService.registerUser(data);
  res.status(201).json(new ApiResponse(true, "User registered successfully", { user }));
});

export const login = asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.loginUser(data);
  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);
  res.status(200).json(new ApiResponse(true, "Login successful", { user, accessToken, refreshToken }));
});

export const refresh = asyncHandler(async (req, res) => {
  let incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!incomingRefreshToken && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      incomingRefreshToken = req.headers.authorization.split(" ")[1];
  }
  if (!incomingRefreshToken) {
    return res.status(401).json(new ApiResponse(false, "Refresh token is required"));
  }
  try {
    const { user, accessToken, refreshToken } = await authService.refreshTokens(incomingRefreshToken);
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);
    return res.status(200).json(new ApiResponse(true, "Token refreshed successfully", { user, accessToken, refreshToken }));
  } catch (error) {
     res.clearCookie("refreshToken", COOKIE_OPTIONS);
     throw new ApiError(401, "Refresh token is invalid or has been revoked");
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.user.id);
  res.clearCookie("refreshToken", COOKIE_OPTIONS);
  res.status(200).json(new ApiResponse(true, "Logged out successfully"));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(email);
  res.status(200).json(new ApiResponse(true, "If that email exists, an OTP has been sent"));
});

export const resetPassword = asyncHandler(async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(data);
  res.status(200).json(new ApiResponse(true, "Password reset successfully"));
});

export const resetPasswordByPhone = asyncHandler(async (req, res) => {
  const { phone, otp, newPassword } = resetPasswordByPhoneSchema.parse(req.body);
  const normalizedPhone = normalizePhone(phone);
  
  const storedOtp = await redisClient.get(`OTP:${normalizedPhone}`);
  if (!storedOtp || storedOtp !== otp) {
    throw new ApiError(400, "Invalid or expired OTP");
  }
  await redisClient.del(`OTP:${normalizedPhone}`);
  await authService.resetPasswordByPhone({ phone: normalizedPhone, newPassword });
  res.status(200).json(new ApiResponse(true, "Password reset successfully"));
});

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(true, "Current user fetched", { user: req.user }));
});

// ==================== OTP SEND (APITXT + 5 MIN COOLDOWN) ====================
export const requestOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json(new ApiResponse(false, "Phone number is required"));
  }

  const normalizedPhone = normalizePhone(phone);

  // 5 Min Cooldown Check
  const cooldown = await redisClient.get(`OTP_COOLDOWN:${normalizedPhone}`);
  if (cooldown) {
    const ttl = await redisClient.ttl(`OTP_COOLDOWN:${normalizedPhone}`);
    const minutes = Math.floor(ttl / 60);
    const seconds = ttl % 60;
    throw new ApiError(429, `Please wait ${minutes}m ${seconds}s before requesting a new OTP.`);
  }

  const existingUser = await findUserByPhone(normalizedPhone);
  const isNewUser = !existingUser;

  const otp = generateOtp(); 
  await redisClient.setEx(`OTP:${normalizedPhone}`, 300, otp); // OTP valid for 5 mins
  await redisClient.setEx(`OTP_COOLDOWN:${normalizedPhone}`, 300, "locked"); // Block resend for 5 mins
  
  const isSent = await sendOTP(normalizedPhone, otp);

  if (!isSent) {
    await redisClient.del(`OTP:${normalizedPhone}`);
    await redisClient.del(`OTP_COOLDOWN:${normalizedPhone}`);
    throw new ApiError(500, "Failed to send OTP. Service unavailable.");
  }

  res.status(200).json(new ApiResponse(true, "OTP sent successfully", { isNewUser }));
});

// ==================== OTP VERIFY & LOGIN ====================
export const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp, name } = patientPhoneAuthSchema.parse(req.body);
  const normalizedPhone = normalizePhone(phone);

  const storedOtp = await redisClient.get(`OTP:${normalizedPhone}`);
  if (!storedOtp || storedOtp !== otp) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  const { user, accessToken, refreshToken, isNewAccount } = await authService.patientPhoneAuth({ phone: normalizedPhone, name });

  // Only delete OTP after successful verification
  await redisClient.del(`OTP:${normalizedPhone}`);
  await redisClient.del(`OTP_COOLDOWN:${normalizedPhone}`);

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  res.status(200).json(
    new ApiResponse(true, isNewAccount ? "Account created" : "Login successful", {
      user,
      accessToken,
      refreshToken,
      isNewAccount,
    })
  );
});
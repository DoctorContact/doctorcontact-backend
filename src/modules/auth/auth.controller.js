import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import { COOKIE_OPTIONS } from "./auth.constants.js";

import {
  registerSchema,
  loginSchema,
  patientPhoneAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resetPasswordByPhoneSchema,
} from "./auth.validation.js";

import * as authService from "./auth.service.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../../utils/tokenGenerator.js";

import { updateRefreshToken } from "./auth.repository.js";
import { hashToken } from "./auth.helper.js";

// ==================== GOOGLE CALLBACK ====================

export const googleCallback = asyncHandler(async (req, res) => {
  const user = req.user;

  const payload = {
    id: user.id,
    role: user.role,
    email: user.email,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await updateRefreshToken(user.id, hashToken(refreshToken));

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  res.redirect(
    `${process.env.CLIENT_URL}/oauth-success?accessToken=${accessToken}`
  );
});

// ==================== REGISTER ====================

export const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  const user = await authService.registerUser(data);

  res
    .status(201)
    .json(
      new ApiResponse(true, "User registered successfully", {
        user,
      })
    );
});

// ==================== LOGIN ====================

export const login = asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);

  const { user, accessToken, refreshToken } =
    await authService.loginUser(data);

  res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  res.status(200).json(
    new ApiResponse(true, "Login successful", {
      user,
      accessToken,
      refreshToken,
    })
  );
});

// ==================== PATIENT PHONE/OTP LOGIN (& SIGNUP) ====================

export const patientPhoneAuth = asyncHandler(async (req, res) => {
  const data = patientPhoneAuthSchema.parse(req.body);

  const { user, accessToken, refreshToken, isNewAccount } =
    await authService.patientPhoneAuth(data);

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

// ==================== REFRESH TOKEN ====================

export const refresh = asyncHandler(async (req, res) => {
  // 🟢 Update: Header থেকেও রিফ্রেশ টোকেন নেওয়ার অপশন রাখা হলো, যদি ফ্রন্টএন্ড থেকে Header এ পাঠায়
  let incomingRefreshToken =
    req.cookies?.refreshToken || req.body?.refreshToken;

  // Header Authorization চেক (Optionally)
  if (!incomingRefreshToken && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      incomingRefreshToken = req.headers.authorization.split(" ")[1];
  }

  if (!incomingRefreshToken) {
    // 🟢 Update: 401 রিটার্ন করো, throw ApiError না করে (যাতে লুপ না হয়)
    return res.status(401).json(new ApiResponse(false, "Refresh token is required"));
  }

  try {
    const { user, accessToken, refreshToken } = await authService.refreshTokens(incomingRefreshToken);

    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

    return res.status(200).json(
      new ApiResponse(true, "Token refreshed successfully", {
        user,
        accessToken,
        refreshToken, // 🟢 Update: Response body তেও রিফ্রেশ টোকেন পাঠিয়ে দেওয়া হলো
      })
    );
  } catch (error) {
     // 🟢 Update: রিফ্রেশ টোকেন এক্সপায়ার হলে কুকি ক্লিয়ার করে দাও
     res.clearCookie("refreshToken", COOKIE_OPTIONS);
     throw new ApiError(401, "Refresh token is invalid or has been revoked");
  }
});

// ==================== LOGOUT ====================

export const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.user.id);

  res.clearCookie("refreshToken", COOKIE_OPTIONS);

  res
    .status(200)
    .json(
      new ApiResponse(true, "Logged out successfully")
    );
});

// ==================== FORGOT PASSWORD ====================

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);

  await authService.forgotPassword(email);

  res.status(200).json(
    new ApiResponse(
      true,
      "If that email exists, an OTP has been sent"
    )
  );
});

// ==================== RESET PASSWORD ====================

export const resetPassword = asyncHandler(async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);

  await authService.resetPassword(data);

  res
    .status(200)
    .json(
      new ApiResponse(true, "Password reset successfully")
    );
});

// ==================== RESET PASSWORD (PHONE) ====================

export const resetPasswordByPhone = asyncHandler(async (req, res) => {
  const data = resetPasswordByPhoneSchema.parse(req.body);

  await authService.resetPasswordByPhone(data);

  res
    .status(200)
    .json(
      new ApiResponse(true, "Password reset successfully")
    );
});

// ==================== GET CURRENT USER ====================

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(true, "Current user fetched", {
      user: req.user,
    })
  );
});

import { Router } from "express";
import passport from "passport";
import * as authController from "./auth.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { authLimiter, otpLimiter } from "../../middlewares/rateLimiter.middleware.js";

const router = Router();

router.post("/login", authLimiter, authController.login);

// Ekhane Firebase er route-ta replace kora holo
router.post("/send-otp", otpLimiter, authController.requestOtp);
router.post("/verify-otp", authLimiter, authController.verifyOtp);

router.post("/refresh", authController.refresh);
router.post("/forgot-password", otpLimiter, authController.forgotPassword);
router.post("/reset-password", otpLimiter, authController.resetPassword);
router.post("/reset-password/phone", otpLimiter, authController.resetPasswordByPhone);
router.post("/logout", authMiddleware, authController.logout);
router.get("/me", authMiddleware, authController.getMe);
router.post("/patient/phone", authLimiter, authController.patientPhoneAuth);

export default router;
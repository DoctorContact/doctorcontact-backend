import { Router } from "express";
import passport from "passport";
import * as authController from "./auth.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import { authLimiter, otpLimiter } from "../../middlewares/rateLimiter.middleware.js";

const router = Router();

// NOTE: The old email+password self-registration endpoint (/auth/register,
// which always created a PATIENT) has been retired — patients now sign up
// and log in exclusively through POST /auth/patient/phone (Firebase OTP).
// authController.register / authService.registerUser are left in place,
// unused, in case a different reuse is decided later — just not routed.

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in with (email OR phone) + password — Doctor/Clinic/Receptionist/Admin/Super Admin (Patients use /auth/patient/phone instead)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: anil@test.com
 *               phone:
 *                 type: string
 *                 example: "+919777777777"
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login successful, returns accessToken and sets refreshToken cookie
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account deactivated
 */
router.post("/login", authLimiter, authController.login);

/**
 * @swagger
 * /auth/patient/phone:
 *   post:
 *     summary: Patient login AND signup in one call — verifies a Firebase Phone Auth ID token (patients have no password)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: ID token returned by the Firebase client SDK after the user confirms the SMS OTP
 *               name:
 *                 type: string
 *                 description: Required only the first time (brand new phone number)
 *     responses:
 *       200:
 *         description: Returns accessToken/refreshToken and the user (isNewAccount indicates signup vs login)
 *       400:
 *         description: Invalid token, or name missing for a first-time signup
 *       409:
 *         description: This phone number belongs to a non-Patient account
 */
router.post("/patient/phone", authLimiter, authController.patientPhoneAuth);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Get a new access token using the refresh token cookie
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: New accessToken issued
 *       401:
 *         description: Refresh token missing, invalid, or revoked
 */
router.post("/refresh", authController.refresh);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password-reset OTP via email (self-registered patients only)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent if the email exists (response is intentionally non-revealing)
 */
router.post("/forgot-password", otpLimiter, authController.forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using the OTP sent by forgot-password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *                 example: "483920"
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post("/reset-password", otpLimiter, authController.resetPassword);

/**
 * @swagger
 * /auth/reset-password/phone:
 *   post:
 *     summary: Reset password for Doctor/Clinic/Receptionist/Admin using a Firebase phone OTP (one call, no separate send-OTP step)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken, newPassword]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: ID token returned by the Firebase client SDK after the user confirms the SMS OTP for their account's phone number
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       403:
 *         description: Account was created by a Clinic/Admin and can't self-reset
 *       404:
 *         description: No account found with this phone number
 */
router.post("/reset-password/phone", otpLimiter, authController.resetPasswordByPhone);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out and clear the refresh token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", authMiddleware, authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get the currently authenticated user's profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user fetched
 *       401:
 *         description: Missing or invalid access token
 */
router.get("/me", authMiddleware, authController.getMe);

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/api/v1/auth/google/failure" }),
  authController.googleCallback
);

router.get("/google/failure", (req, res) => {
  res.status(401).json({ success: false, message: "Google authentication failed" });
});

export default router;
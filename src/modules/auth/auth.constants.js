export const OTP_EXPIRY_SECONDS = 5 * 60; // 5 minutes
export const OTP_PREFIX = "otp:reset:";

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", 
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", 
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
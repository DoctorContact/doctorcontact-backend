import axios from 'axios';
import prisma from '../../config/db.config.js';
import ApiError from '../../utils/apiError.js';
import { normalizePhone } from '../../utils/phoneNormalizer.js';

export const generateAndSendOtp = async (phone) => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new ApiError(400, "Invalid Indian mobile number");
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins expiry

  // Upsert OTP in database
  await prisma.otpSession.upsert({
    where: { phone: normalizedPhone },
    update: { otp, expiresAt },
    create: { phone: normalizedPhone, otp, expiresAt }
  });

  // Fast2SMS API Call (Using generic route for testing)
  try {
    await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: process.env.FAST2SMS_API_KEY,
        variables_values: otp,
        route: 'otp',
        numbers: normalizedPhone
      }
    });
    return true;
  } catch (error) {
    console.error("Fast2SMS Error:", error.response?.data || error.message);
    throw new ApiError(500, "Failed to send OTP via SMS provider");
  }
};

export const verifyOtp = async (phone, otp) => {
  const normalizedPhone = normalizePhone(phone);
  const session = await prisma.otpSession.findUnique({ where: { phone: normalizedPhone } });

  if (!session) throw new ApiError(400, "No OTP requested for this number");
  if (session.otp !== otp) throw new ApiError(400, "Invalid OTP");
  if (new Date() > session.expiresAt) throw new ApiError(400, "OTP has expired");

  // Delete OTP after successful verification
  await prisma.otpSession.delete({ where: { phone: normalizedPhone } });
  
  return true;
};
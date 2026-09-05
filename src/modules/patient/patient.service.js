import { normalizePhone } from "../../utils/phoneNormalizer.js";
import ApiError from "../../utils/apiError.js";
import {
  findPatientByPhone,
  findPatientByUserId,
  createGuestPatient,
  updatePatientProfile,
} from "./patient.repository.js";

export const searchPatientByPhone = async (phone) => {
  const normalizedPhone = normalizePhone(phone);
  const patient = await findPatientByPhone(normalizedPhone);

  if (!patient) return null;

  // Present a unified shape regardless of guest vs self-registered
  return {
    id: patient.id,
    name: patient.user?.name || patient.name,
    phone: patient.user?.phone || patient.phone,
    email: patient.user?.email || null,
    gender: patient.gender,
    hasVerifiedAccount: !!patient.user?.id,
  };
};

// Clinic/Receptionist quick-add. Always ends up with a full account behind
// the phone number (see patient.repository.createGuestPatient) — if this
// phone is already a Patient anywhere in the system, the existing record is
// reused rather than erroring out, since the person may later log in with
// this same phone via OTP and should land in one continuous account/history.
export const createGuest = async (payload) => {
  if (!payload.phone) {
    throw new ApiError(400, "Mobile number is required");
  }

  return createGuestPatient({
    name: payload.name,
    phone: normalizePhone(payload.phone),
    gender: payload.gender,
  });
};

export const getMyProfile = async (userId) => {
  const patient = await findPatientByUserId(userId);
  if (!patient) throw new ApiError(404, "Patient profile not found");
  return patient;
};

export const updateMyProfile = async (userId, data) => {
  const patient = await findPatientByUserId(userId);
  if (!patient) throw new ApiError(404, "Patient profile not found");
  return updatePatientProfile(userId, data);
};

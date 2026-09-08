import { notifyUser } from "../notification/notification.service.js";
import ApiError from "../../utils/apiError.js";
import { hashPassword } from "../auth/auth.helper.js";
import { findUserByEmail, findUserByPhone } from "../auth/auth.repository.js";
import { updateClinicProfile } from "../clinic/clinic.repository.js";

import {
  findAllUsers,
  countUsers,
  findUserByIdRaw,
  setUserActiveStatus,
} from "../user/user.repository.js";

import {
  getPlatformSettings,
  updatePlatformSettings,
  findAllClinics,
  countClinics,
 updateClinicByAdmin, softDeleteClinic, findClinicByIdRaw,
  setClinicApproval,
  findAllDoctorsUnverified,
  findDoctorByIdRaw,
  setDoctorVerification,
  getPlatformStats,
  createAdminUser,
  createClinicUser,
  createDoctorUser,
  createDiagnosticCenterUser,
  findAllAppointments,
  updateDiagnosticCenterProfile,
  findAllDiagnosticCenters,
  findDiagnosticCenterByIdRaw,
  setDiagnosticCenterApproval,
  setDoctorFeatured,
  findFeaturedDoctors,
} from "./admin.repository.js";

export const getSettings = async () => {
  const settings = await getPlatformSettings();
  if (!settings) throw new ApiError(500, "Platform settings not initialized");
  return settings;
};

export const updateSettings = async ({ bookingWindowMinutes }) => {
  const settings = await getPlatformSettings();
  if (!settings) throw new ApiError(500, "Platform settings not initialized");
  return updatePlatformSettings(settings.id, { bookingWindowMinutes });
};

export const listClinics = async ({ isApproved, page, limit }) => {
  const [clinics, total] = await Promise.all([
    findAllClinics({ isApproved, page, limit }),
    countClinics(isApproved),
  ]);
  return { clinics, total, page, limit };
};

export const approveClinic = async (clinicId) => {
  const clinic = await findClinicByIdRaw(clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");
  if (clinic.isApproved) throw new ApiError(400, "Clinic is already approved");

  const updated = await setClinicApproval(clinicId, true);

  await notifyUser({
    userId: clinic.userId,
    type: "CLINIC_APPROVED",
    title: "Your clinic has been approved",
    message: `${clinic.clinicName} is now approved and visible to patients.`,
  });

  return updated;
};

export const revokeClinicApproval = async (clinicId) => {
  const clinic = await findClinicByIdRaw(clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");

  const updated = await setClinicApproval(clinicId, false);

  await notifyUser({
    userId: clinic.userId,
    type: "CLINIC_REVOKED",
    title: "Your clinic approval has been revoked",
    message: `${clinic.clinicName}'s approval has been revoked by the admin. Please contact support.`,
  });

  return updated;
};

export const listUnverifiedDoctors = async () => {
  return findAllDoctorsUnverified();
};

export const verifyDoctor = async (doctorId) => {
  const doctor = await findDoctorByIdRaw(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");
  if (doctor.isVerified) throw new ApiError(400, "Doctor is already verified");

  const updated = await setDoctorVerification(doctorId, true);

  await notifyUser({
    userId: doctor.userId,
    type: "DOCTOR_VERIFIED",
    title: "You're verified!",
    message: "Your doctor profile has been verified by the admin. Patients can now book you.",
  });

  return updated;
};

export const listUsers = async ({ role, page, limit }) => {
  const [users, total] = await Promise.all([
    findAllUsers({ role, page, limit }),
    countUsers(role),
  ]);
  return { users, total, page, limit };
};

export const toggleUserStatus = async (userId, isActive) => {
  const user = await findUserByIdRaw(userId);
  if (!user) throw new ApiError(404, "User not found");
  if (user.role === "SUPER_ADMIN") {
    throw new ApiError(403, "Cannot modify a Super Admin account");
  }

  return setUserActiveStatus(userId, isActive);
};

export const getStats = async () => {
  return getPlatformStats();
};

// ----------------------------------------------------------------------
// User Creation Methods
// ----------------------------------------------------------------------

export const createAdmin = async ({ name, email, password, phone }) => {
  if (email && (await findUserByEmail(email))) {
    throw new ApiError(409, "A user with this email already exists");
  }
  if (phone && (await findUserByPhone(phone))) {
    throw new ApiError(409, "A user with this phone number already exists");
  }

  const hashedPassword = await hashPassword(password);
  const user = await createAdminUser({ name, email, phone, password: hashedPassword });

  const { password: _pw, refreshToken, ...safeUser } = user;
  return safeUser;
};

export const createDoctor = async ({
  name,
  email,
  password,
  phone,
  clinicId,
  specialization,
  specializationIds,
  qualification,
  experience,
  fee,
}) => {
  if (email && (await findUserByEmail(email))) {
    throw new ApiError(409, "A user with this email already exists");
  }
  if (phone && (await findUserByPhone(phone))) {
    throw new ApiError(409, "A user with this phone number already exists");
  }

  if (clinicId) {
    const clinic = await findClinicByIdRaw(clinicId);
    if (!clinic) throw new ApiError(404, "Clinic not found");
  }

  const hashedPassword = await hashPassword(password);

  try {
    const { user, doctor } = await createDoctorUser({
      userData: { name, email, phone, password: hashedPassword },
      doctorData: {
        clinicId: clinicId ?? null,
        specialization,
        specializationIds,
        qualification,
        experience,
        fee,
      },
    });

    const { password: _pw, refreshToken, ...safeUser } = user;
    return { user: safeUser, doctor };
  } catch (error) {
    if (error.code === "P2002" && error.meta?.target?.includes("phone")) {
      throw new ApiError(409, "This phone number is already registered.");
    }
    throw error;
  }
};

export const listAllBookings = async ({ clinicId, status, from, to, page, limit }) => {
  return findAllAppointments({
    clinicId,
    status,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    page,
    limit,
  });
};

export const createClinic = async ({ name, email, password, phone, clinicName, address, city, state, pincode }) => {
  if (email && (await findUserByEmail(email))) {
    throw new ApiError(409, "A user with this email already exists");
  }
  if (phone && (await findUserByPhone(phone))) {
    throw new ApiError(409, "A user with this phone number already exists");
  }

  const hashedPassword = await hashPassword(password);

  try {
    const { user, clinic } = await createClinicUser({
      userData: { name, email, phone, password: hashedPassword },
      clinicName,
    });

    let finalClinic = clinic;
    if (address || city || state || pincode) {
      finalClinic = await updateClinicProfile(clinic.id, { clinicName, address, city, state, pincode });
    }

    const { password: _pw, refreshToken, ...safeUser } = user;
    return { user: safeUser, clinic: finalClinic };
    
  } catch (error) {
    // Catch unique constraint failed error for Phone
    if (error.code === 'P2002' && error.meta?.target?.includes('phone')) {
      throw new ApiError(409, "This phone number is already registered.");
    }
    throw error;
  }
};

export const createDiagnosticCenter = async ({ name, email, password, phone, centerName, address, city, state, pincode }) => {
  const existing = await findUserByEmail(email);
  if (existing) throw new ApiError(409, "A user with this email already exists");

  const hashedPassword = await hashPassword(password);

  try {
    const { user, diagnosticCenter } = await createDiagnosticCenterUser({
      userData: { name, email, phone, password: hashedPassword },
      centerName,
    });

    let finalCenter = diagnosticCenter;
    if (address || city || state || pincode) {
      finalCenter = await updateDiagnosticCenterProfile(diagnosticCenter.id, { address, city, state, pincode });
    }

    const { password: _pw, refreshToken, ...safeUser } = user;
    return { user: safeUser, diagnosticCenter: finalCenter };
  } catch (error) {
    if (error.code === 'P2002' && error.meta?.target?.includes('phone')) {
      throw new ApiError(400, "This phone number is already registered.");
    }
    throw error;
  }
};

// ----------------------------------------------------------------------
// Diagnostic Center Methods
// ----------------------------------------------------------------------

export const listDiagnosticCenters = async ({ isApproved, page, limit }) => {
  return findAllDiagnosticCenters({ isApproved, page, limit });
};

export const approveDiagnosticCenter = async (id) => {
  const center = await findDiagnosticCenterByIdRaw(id);
  if (!center) throw new ApiError(404, "Diagnostic center not found");
  if (center.isApproved) throw new ApiError(400, "Diagnostic center is already approved");
  return setDiagnosticCenterApproval(id, true);
};

export const revokeDiagnosticCenterApproval = async (id) => {
  const center = await findDiagnosticCenterByIdRaw(id);
  if (!center) throw new ApiError(404, "Diagnostic center not found");
  return setDiagnosticCenterApproval(id, false);
};

// ----------------------------------------------------------------------
// Featured Doctors Methods
// ----------------------------------------------------------------------

export const setDoctorFeaturedStatus = async (doctorId, isFeatured, featuredOrder) => {
  const doctor = await findDoctorByIdRaw(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  return setDoctorFeatured(doctorId, isFeatured, featuredOrder);
};

export const listFeaturedDoctors = async () => {
  return findFeaturedDoctors();
};

export const editClinic = async (clinicId, payload) => {
  const clinic = await findClinicByIdRaw(clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");
  
  return updateClinicByAdmin(clinicId, payload);
};

export const deactivateClinic = async (clinicId) => {
  const clinic = await findClinicByIdRaw(clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");

  try {
    return await softDeleteClinic(clinicId);
  } catch (error) {
    throw new ApiError(500, "Failed to deactivate clinic");
  }
};
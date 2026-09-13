import ApiError from "../../utils/apiError.js";
import { notifyUser } from "../notification/notification.service.js";
import { logAudit } from "../audit/audit.service.js";
import {
  createReferral,
  findReferralById,
  updateReferral,
  findReferralsForPatient,
  findReferralsForDiagnosticCenter,
  countReferralsForDiagnosticCenter,
  findReferralsForClinic,
  findReferralsForCreator,
  findAllReferrals,
  getPatientByUserId,
  getPatientById,
  getDiagnosticCenterById,
  getDoctorByUserId,
  getClinicByUserId,
  getReceptionistByUserId,
  getDiagnosticStaffByUserId,
  getApprovedClinicIdsForDoctor,
  getAppointmentClinicId,
} from "./testReferral.repository.js";
import { findCenterByUserId } from "../diagnosticCenter/diagnosticCenter.repository.js";

// Resolve which diagnostic center this user (owner or staff) belongs to.
const resolveDiagnosticCenterId = async (user) => {
  if (user.role === "DIAGNOSTIC_CENTER") {
    const center = await findCenterByUserId(user.id);
    if (!center) throw new ApiError(404, "Diagnostic center profile not found");
    return center.id;
  }
  if (user.role === "DIAGNOSTIC_STAFF") {
    const staff = await getDiagnosticStaffByUserId(user.id);
    if (!staff) throw new ApiError(404, "Staff profile not found");
    return staff.diagnosticCenterId;
  }
  throw new ApiError(403, "Only a Diagnostic Center or its staff can perform this action");
};

const resolveCreatorContext = async (user, { appointmentId } = {}) => {
  if (user.role === "DOCTOR") {
    const doctor = await getDoctorByUserId(user.id);
    if (!doctor) throw new ApiError(404, "Doctor profile not found");

    // Prefer the clinic of the specific appointment/visit this referral is
    // being made from — this is always correct even for a doctor who works
    // at several clinics (Part 12 principle: never guess a doctor's clinic).
    if (appointmentId) {
      const clinicId = await getAppointmentClinicId(appointmentId);
      if (clinicId) return { referringClinicId: clinicId, createdByRole: "DOCTOR" };
    }

    // Fall back to the doctor's primary clinicId (legacy field), then to
    // any approved clinic association — `clinicId` can be null for a
    // doctor who only ever joined clinics via associations.
    if (doctor.clinicId) {
      return { referringClinicId: doctor.clinicId, createdByRole: "DOCTOR" };
    }
    const [firstAssociatedClinicId] = await getApprovedClinicIdsForDoctor(doctor.id);
    if (firstAssociatedClinicId) {
      return { referringClinicId: firstAssociatedClinicId, createdByRole: "DOCTOR" };
    }
    throw new ApiError(400, "You are not currently associated with any clinic");
  }

  if (user.role === "RECEPTIONIST") {
    const receptionist = await getReceptionistByUserId(user.id);
    if (!receptionist) throw new ApiError(404, "Receptionist profile not found");
    return { referringClinicId: receptionist.clinicId, createdByRole: "RECEPTIONIST" };
  }

  if (user.role === "CLINIC") {
    const clinic = await getClinicByUserId(user.id);
    if (!clinic) throw new ApiError(404, "Clinic profile not found");
    return { referringClinicId: clinic.id, createdByRole: "CLINIC" };
  }

  throw new ApiError(403, "Only a Doctor, Receptionist, or Clinic can create a test referral");
};

export const createTestReferral = async (user, { patientId, appointmentId, diagnosticCenterId, testNames, notes }) => {
  const { referringClinicId, createdByRole } = await resolveCreatorContext(user, { appointmentId });

  const patient = await getPatientById(patientId);
  if (!patient) throw new ApiError(404, "Patient not found");

  const center = await getDiagnosticCenterById(diagnosticCenterId);
  if (!center) throw new ApiError(404, "Diagnostic center not found");
  if (!center.isApproved) throw new ApiError(400, "This diagnostic center is not yet approved");

  const referral = await createReferral({
    patientId,
    appointmentId,
    diagnosticCenterId,
    testNames,
    notes,
    referringClinicId,
    createdByUserId: user.id,
    createdByRole,
  });

  const patientDisplayName = patient.name || "A patient";

  // Notify the patient
  if (patient.userId) {
    await notifyUser({
      userId: patient.userId,
      type: "GENERAL",
      title: "Test Referral Created",
      message: `You've been referred for: ${testNames.join(", ")} at ${center.centerName}.`,
      meta: { referralId: referral.id, diagnosticCenterId, testNames },
    });
  }

  // Notify the diagnostic center itself — this was missing before
  await notifyUser({
    userId: center.userId,
    type: "GENERAL",
    title: "New Test Referral Received",
    message: `${patientDisplayName} has been referred to you for: ${testNames.join(", ")}.`,
    meta: { referralId: referral.id, patientId, testNames, createdByRole },
  });

  return referral;
};

export const getMyReferralsAsPatient = async (userId, { page, limit }) => {
  const patient = await getPatientByUserId(userId);
  if (!patient) throw new ApiError(404, "Patient profile not found");
  return findReferralsForPatient({ patientId: patient.id, page, limit });
};

export const getIncomingReferrals = async (user, { page, limit, status }) => {
  const diagnosticCenterId = await resolveDiagnosticCenterId(user);
  return findReferralsForDiagnosticCenter({ diagnosticCenterId, page, limit, status });
};

// Dashboard summary for the diagnostic center / staff portal.
export const getCenterReferralStats = async (user) => {
  const diagnosticCenterId = await resolveDiagnosticCenterId(user);
  return countReferralsForDiagnosticCenter(diagnosticCenterId);
};

// Single referral, visible to the patient it belongs to, the referring clinic,
// or the diagnostic center / staff it was sent to.
export const getReferralDetails = async (user, id) => {
  const referral = await findReferralById(id);
  if (!referral) throw new ApiError(404, "Referral not found");

  if (user.role === "PATIENT") {
    if (referral.patient?.userId !== user.id) throw new ApiError(403, "Not your referral");
  } else if (user.role === "DIAGNOSTIC_CENTER" || user.role === "DIAGNOSTIC_STAFF") {
    const centerId = await resolveDiagnosticCenterId(user);
    if (referral.diagnosticCenterId !== centerId) throw new ApiError(403, "Not your referral");
  } else if (user.role === "CLINIC") {
    const clinic = await getClinicByUserId(user.id);
    if (!clinic || referral.referringClinicId !== clinic.id) throw new ApiError(403, "Not your referral");
  } else if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw new ApiError(403, "Not allowed");
  }

  return referral;
};

// Diagnostic center / staff move a referral through its processing workflow.
export const updateReferralStatus = async (user, id, { status, resultNotes }) => {
  const centerId = await resolveDiagnosticCenterId(user);

  const referral = await findReferralById(id);
  if (!referral) throw new ApiError(404, "Referral not found");
  if (referral.diagnosticCenterId !== centerId) throw new ApiError(403, "Not your referral");

  const updated = await updateReferral(id, {
    status,
    ...(resultNotes !== undefined && { resultNotes }),
    processedByUserId: user.id,
    ...(status === "COMPLETED" && { completedAt: new Date() }),
  });

  // Keep the patient informed as their test progresses.
  if (referral.patient?.userId) {
    const labels = {
      PENDING: "is pending",
      IN_PROGRESS: "is now in progress",
      COMPLETED: "has been completed",
      CANCELLED: "has been cancelled",
    };
    await notifyUser({
      userId: referral.patient.userId,
      type: "GENERAL",
      title: "Test Update",
      message: `Your test (${referral.testNames.join(", ")}) at ${referral.diagnosticCenter?.centerName ?? "the diagnostic center"} ${labels[status]}.`,
      meta: { referralId: id, status },
    });
  }

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "TEST_REFERRAL_STATUS_UPDATED",
    targetType: "TestReferral",
    targetId: id,
    meta: { status },
  });

  return updated;
};

// Part: CLINIC sees every referral sent under their clinic; DOCTOR/
// RECEPTIONIST see only the ones they personally created — this used to be
// CLINIC-only, which meant a doctor calling this endpoint got a hard 404
// ("Clinic profile not found") since they have no Clinic record at all.
export const getSentReferrals = async (user, { page, limit }) => {
  if (user.role === "CLINIC") {
    const clinic = await getClinicByUserId(user.id);
    if (!clinic) throw new ApiError(404, "Clinic profile not found");
    return findReferralsForClinic({ clinicId: clinic.id, page, limit });
  }

  if (user.role === "DOCTOR" || user.role === "RECEPTIONIST") {
    return findReferralsForCreator({ createdByUserId: user.id, page, limit });
  }

  throw new ApiError(403, "Only a Doctor, Receptionist, or Clinic can view sent referrals");
};

export const getAllReferralsForAdmin = async ({ page, limit }) => {
  return findAllReferrals({ page, limit });
};
import ApiError from "../../utils/apiError.js";
import { findClinicByUserId } from "../clinic/clinic.repository.js";
import { findDoctorByUserId } from "../doctor/doctor.repository.js";
import { findReceptionistAssignment } from "../queue/queue.repository.js";
import { getPatientById } from "../appointment/appointment.repository.js";
import { notifyUser } from "../notification/notification.service.js";
import { logAudit } from "../audit/audit.service.js";
import { findPatientByUserId } from "../patient/patient.repository.js";
import {
  createFollowup,
  findFollowupById,
  listFollowupsForClinic,
  listFollowupsForPatient,
  updateFollowupStatus,
} from "./followup.repository.js";

// Doctor (themself), Clinic (their own clinic), Receptionist (assigned to
// this doctor at this clinic), or Admin/Super Admin can schedule a follow-up.
const assertFollowupAccess = async (user, doctorId, clinicId) => {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;

  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== clinicId) {
      throw new ApiError(403, "You can only schedule follow-ups for your own clinic");
    }
    return;
  }

  if (user.role === "DOCTOR") {
    const doctor = await findDoctorByUserId(user.id);
    if (!doctor || doctor.id !== doctorId) {
      throw new ApiError(403, "You can only schedule follow-ups for your own patients");
    }
    return;
  }

  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) {
      throw new ApiError(403, "You are not assigned to this doctor at this clinic");
    }
    return;
  }

  throw new ApiError(403, "You do not have permission to schedule follow-ups");
};

export const scheduleFollowup = async (user, { patientId, doctorId, clinicId, appointmentId, followUpDate, notes }) => {
  await assertFollowupAccess(user, doctorId, clinicId);

  const patient = await getPatientById(patientId);
  if (!patient) throw new ApiError(404, "Patient not found");

  const followup = await createFollowup({
    patientId,
    doctorId,
    clinicId,
    appointmentId: appointmentId || null,
    followUpDate: new Date(followUpDate),
    notes,
    createdByUserId: user.id,
    createdByRole: user.role,
  });

  if (patient.userId) {
    await notifyUser({
      userId: patient.userId,
      type: "GENERAL",
      title: "Follow-up Scheduled",
      message: `A follow-up visit has been scheduled for you on ${followUpDate}.`,
      meta: { followupId: followup.id, doctorId, clinicId, followUpDate },
    });
  }

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "FOLLOWUP_SCHEDULED",
    targetType: "Followup",
    targetId: followup.id,
    meta: { patientId, doctorId, clinicId, followUpDate },
  });

  return followup;
};

// "clinic er kache ekta jayga thakbe dekhte pabe kake kake diyeche" — list of
// everyone this clinic (optionally one doctor) has scheduled a follow-up for.
export const getClinicFollowups = async (user, clinicId, filters) => {
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    const clinic = await findClinicByUserId(user.id);
    if (user.role === "CLINIC" && (!clinic || clinic.id !== clinicId)) {
      throw new ApiError(403, "You can only view your own clinic's follow-ups");
    }
    if (user.role === "RECEPTIONIST") {
      // Receptionists implicitly see their clinic's list — no extra check
      // needed beyond clinicId matching their own assignments elsewhere.
    }
    if (user.role === "DOCTOR") {
      const doctor = await findDoctorByUserId(user.id);
      if (!doctor) throw new ApiError(403, "Not authorized");
      filters = { ...filters, doctorId: doctor.id };
    }
  }
  return listFollowupsForClinic(clinicId, filters);
};

export const getMyFollowups = async (patientUserId) => {
  const patient = await findPatientByUserId(patientUserId);
  if (!patient) throw new ApiError(404, "Patient profile not found");
  return listFollowupsForPatient(patient.id);
};

export const cancelFollowup = async (user, followupId) => {
  const followup = await findFollowupById(followupId);
  if (!followup) throw new ApiError(404, "Follow-up not found");
  await assertFollowupAccess(user, followup.doctorId, followup.clinicId);
  return updateFollowupStatus(followupId, "CANCELLED");
};

export const completeFollowup = async (user, followupId) => {
  const followup = await findFollowupById(followupId);
  if (!followup) throw new ApiError(404, "Follow-up not found");
  await assertFollowupAccess(user, followup.doctorId, followup.clinicId);
  return updateFollowupStatus(followupId, "COMPLETED");
};

import { notifyUser } from "../notification/notification.service.js";
import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import { Prisma } from "@prisma/client";
import { findClinicByUserId, findClinicById } from "../clinic/clinic.repository.js";
import {
  searchDoctorsByName,
  findDoctorByIdWithUser,
  findDoctorByUserId,
  findApprovedAssociationsForDoctor,
  createAssociationRequest,
  findAssociationById,
  updateAssociationStatus,
  createDoctorLeave,
  removeDoctorLeave,
  findLeaveForDate,
  findUpcomingLeaves,
  getAllVerifiedDoctors,
  getFeaturedDoctors,
  getAvailableDoctors,
  getDoctorByIdWithClinic,
  updateDoctorDetails,
  updateDoctorAvgConsultation,
  findApprovedAssociationByDoctorAndClinic,
  updateAssociationAvgConsultation,
  updateDoctorProfilePhoto,
  searchDoctorsAdvancedDB,
} from "./doctor.repository.js";
import { findConflict } from "./schedule.helper.js";
import { emitDoctorDelay } from "../../sockets/queue.socket.js";
import { emitLiveDoctorsChanged } from "../../sockets/doctor.socket.js";
import { findReceptionistAssignment } from "../queue/queue.repository.js";
import { emitAppointmentNotification } from "../../sockets/notification.socket.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import { evaluateDoctorStatus } from "./doctor.helper.js";

import { checkScheduleConflict } from "./schedule.helper.js";
import {
  createDoctorSchedule,
  updateDoctorSchedule,
  deleteDoctorSchedule,
  findDoctorSchedules,
  findDoctorScheduleById,
  upsertScheduleException,
  listScheduleExceptions,
  deleteScheduleException,
  listExceptionsForSchedulesOnDate,
} from "./doctor.repository.js";
import { logAudit } from "../audit/audit.service.js";

export const searchByName = async (name) => {
  return searchDoctorsByName(name);
};

// Clinic sends a request to a doctor
export const sendRequestToDoctor = async (clinicUserId, payload) => {
  const clinic = await findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  if (!clinic.isApproved) throw new ApiError(403, "Your clinic is not yet approved by admin");

  const doctor = await findDoctorByIdWithUser(payload.doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const existingApproved = await findApprovedAssociationsForDoctor(doctor.id);
  const conflict = findConflict(payload, existingApproved);

  // 1. Create the legacy association for basic clinic linkage
  const association = await createAssociationRequest({
    doctorId: doctor.id,
    clinicId: clinic.id,
    fee: payload.fee,
    dayOfWeek: payload.dayOfWeek || "MONDAY",
    startTime: payload.startTime || "10:00",
    endTime: payload.endTime || "12:00",
    status: "PENDING",
    requestedBy: "CLINIC",
  });

  // 2. 🟢 FIX: Safely generate the REAL DoctorSchedule
  if (payload.startTime && payload.endTime) {
    await createDoctorSchedule({
      doctorId: doctor.id,
      clinicId: clinic.id,
      startTime: payload.startTime,
      endTime: payload.endTime,
      maxPatients: payload.maxPatients || 20,
      recurrenceType: payload.recurrenceType || "DAILY",
      recurrencePattern: payload.recurrencePattern || {},
      isActive: true
    });
  }

  return {
    association,
    conflictWarning: conflict
      ? "Note: this time slot currently conflicts with an approved schedule at another clinic."
      : null,
  };
};

// Doctor responds to a clinic's request
export const respondToClinicRequest = async (doctorUserId, associationId, action) => {
  const association = await findAssociationById(associationId);
  if (!association) throw new ApiError(404, "Request not found");

  const doctor = await findDoctorByUserId(doctorUserId);
  if (!doctor || doctor.id !== association.doctorId) {
    throw new ApiError(403, "This request does not belong to you");
  }

  if (association.status !== "PENDING") {
    throw new ApiError(400, `This request has already been ${association.status.toLowerCase()}`);
  }

  if (action === "REJECT") {
    return updateAssociationStatus(associationId, "REJECTED");
  }

  return approveAssociationSafely(associationId, association.doctorId);
};


// ==============================================
// REQUEST FETCHING LOGIC (For Both Doctor & Clinic)
// ==============================================

export const getMyReceivedRequests = async (userId) => {
  const doctor = await findDoctorByUserId(userId);
  if (doctor) {
    return prisma.doctorClinicAssociation.findMany({
      where: { doctorId: doctor.id, requestedBy: "CLINIC" },
      include: { clinic: { select: { clinicName: true, city: true, logo: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  const clinic = await findClinicByUserId(userId);
  if (clinic) {
    return prisma.doctorClinicAssociation.findMany({
      where: { clinicId: clinic.id, requestedBy: "DOCTOR" },
      include: { doctor: { include: { user: { select: { name: true, avatar: true } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  throw new ApiError(404, "Profile not found");
};

export const getMySentRequests = async (userId) => {
  const doctor = await findDoctorByUserId(userId);
  if (doctor) {
    return prisma.doctorClinicAssociation.findMany({
      where: { doctorId: doctor.id, requestedBy: "DOCTOR" },
      include: { clinic: { select: { clinicName: true, city: true, logo: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  const clinic = await findClinicByUserId(userId);
  if (clinic) {
    return prisma.doctorClinicAssociation.findMany({
      where: { clinicId: clinic.id, requestedBy: "CLINIC" },
      include: { doctor: { include: { user: { select: { name: true, avatar: true } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  throw new ApiError(404, "Profile not found");
};

// ==============================================

// Doctor sends a request to a clinic
export const sendRequestToClinic = async (doctorUserId, payload) => {
  const doctor = await findDoctorByUserId(doctorUserId);
  if (!doctor) throw new ApiError(404, "Doctor profile not found");
  if (!doctor.isVerified) throw new ApiError(403, "Your profile is not yet verified by admin");

  const clinic = await findClinicById(payload.clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");
  if (!clinic.isApproved) throw new ApiError(400, "This clinic is not yet approved");

  const existingApproved = await findApprovedAssociationsForDoctor(doctor.id);
  const conflict = findConflict(payload, existingApproved);

  const association = await createAssociationRequest({
    doctorId: doctor.id,
    clinicId: clinic.id,
    fee: payload.fee,
    dayOfWeek: payload.dayOfWeek,
    startTime: payload.startTime,
    endTime: payload.endTime,
    status: "PENDING",
    requestedBy: "DOCTOR",
  });

  return {
    association,
    conflictWarning: conflict
      ? "Note: this time slot currently conflicts with an approved schedule at another clinic. It will stay PENDING until that conflict is resolved."
      : null,
  };
};

// Clinic responds to a doctor's request
export const respondToDoctorRequest = async (clinicUserId, associationId, action) => {
  const association = await findAssociationById(associationId);
  if (!association) throw new ApiError(404, "Request not found");

  const clinic = await findClinicByUserId(clinicUserId);
  if (!clinic || clinic.id !== association.clinicId) {
    throw new ApiError(403, "This request does not belong to your clinic");
  }

  if (association.status !== "PENDING") {
    throw new ApiError(400, `This request has already been ${association.status.toLowerCase()}`);
  }

  if (action === "REJECT") {
    return updateAssociationStatus(associationId, "REJECTED");
  }

  return approveAssociationSafely(associationId, association.doctorId);
};

const approveAssociationSafely = async (associationId, doctorId) => {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.doctorClinicAssociation.findUnique({ where: { id: associationId } });
        if (!current || current.status !== "PENDING") {
          throw new ApiError(
            400,
            `This request has already been ${current ? current.status.toLowerCase() : "removed"}`
          );
        }

        const existingApproved = await tx.doctorClinicAssociation.findMany({
          where: { doctorId, status: "APPROVED" },
        });

        const conflict = findConflict(current, existingApproved);
        if (conflict) {
          throw new ApiError(
            409,
            `Cannot approve — this overlaps with an already-approved schedule (${conflict.dayOfWeek} ${conflict.startTime}-${conflict.endTime}) at another clinic`
          );
        }

        return tx.doctorClinicAssociation.update({ where: { id: associationId }, data: { status: "APPROVED" } });
      },
      { isolation: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.code === "P2034") {
      throw new ApiError(409, "This approval conflicted with another concurrent request — please try again");
    }
    throw err;
  }
};

export const cancelAssociation = async (userId, userRole, associationId) => {
  const association = await findAssociationById(associationId);
  if (!association) throw new ApiError(404, "Association not found");

  if (userRole === "DOCTOR") {
    const doctor = await findDoctorByUserId(userId);
    if (!doctor || doctor.id !== association.doctorId) {
      throw new ApiError(403, "This association does not belong to you");
    }
  } else if (userRole === "CLINIC") {
    const clinic = await findClinicByUserId(userId);
    if (!clinic || clinic.id !== association.clinicId) {
      throw new ApiError(403, "This association does not belong to your clinic");
    }
  }

  if (association.status === "CANCELLED" || association.status === "REJECTED") {
    throw new ApiError(400, `This association is already ${association.status.toLowerCase()}`);
  }

  return updateAssociationStatus(associationId, "CANCELLED");
};

export const updateConsultationTime = async (user, doctorId, clinicId, minutes) => {
  const doctor = await findDoctorByIdWithUser(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const isPrimaryClinic = doctor.clinicId === clinicId;
  let association = null;

  if (!isPrimaryClinic) {
    association = await findApprovedAssociationByDoctorAndClinic(doctorId, clinicId);
    if (!association) throw new ApiError(404, "Doctor is not associated with this clinic");
  }

  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") {
    // allowed
  } else if (user.role === "DOCTOR") {
    if (doctor.userId !== user.id) throw new ApiError(403, "This is not your profile");
  } else if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== clinicId) {
      throw new ApiError(403, "You can only manage doctors at your own clinic");
    }
  } else if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) {
      throw new ApiError(403, "You are not assigned to manage this doctor at this clinic");
    }
  } else {
    throw new ApiError(403, "You do not have permission to update this setting");
  }

  if (isPrimaryClinic) {
    return updateDoctorAvgConsultation(doctorId, minutes);
  }
  return updateAssociationAvgConsultation(association.id, minutes);
};

const notifyApproaching = async (doctorId, clinicId, date, currentToken) => {
  const targetToken = currentToken + APPROACH_THRESHOLD;
  const upcoming = await findAppointmentByToken(doctorId, clinicId, date, targetToken);
  if (upcoming) {
    emitAppointmentNotification(upcoming.id, {
      type: "APPROACHING",
      message: `Your turn is approaching — ${APPROACH_THRESHOLD} patient(s) ahead of you.`,
      token: upcoming.token,
    });
  }
};

const assertDoctorClinicManageAccess = async (user, doctorId, clinicId) => {
  const doctor = await findDoctorByIdWithUser(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;

  if (user.role === "DOCTOR") {
    if (doctor.userId !== user.id) {
      throw new ApiError(403, "You can only manage your own schedule");
    }
    return;
  }

  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== clinicId) {
      throw new ApiError(403, "You can only manage doctors at your own clinic");
    }
    return;
  }

  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) {
      throw new ApiError(403, "You are not assigned to manage this doctor at this clinic");
    }
    return;
  }

  throw new ApiError(403, "You do not have permission to manage this");
};

export const markDoctorOnLeave = async (user, doctorId, clinicId, date, reason) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const existing = await findLeaveForDate(doctorId, clinicId, date);
  if (existing) throw new ApiError(409, "Doctor is already marked on leave for this date");

  const leave = await createDoctorLeave(doctorId, clinicId, date, reason);

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "DOCTOR_MARKED_ON_LEAVE",
    targetType: "Doctor",
    targetId: doctorId,
    meta: { clinicId, date, reason },
  });

  emitLiveDoctorsChanged({ reason: "doctor_leave", doctorId, clinicId });
  return leave;
};

export const cancelDoctorLeave = async (user, doctorId, clinicId, date) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const result = await removeDoctorLeave(doctorId, clinicId, date);
  if (result.count === 0) throw new ApiError(404, "No leave found for this date");
  emitLiveDoctorsChanged({ reason: "doctor_leave_cancelled", doctorId, clinicId });
  return { removed: true };
};

export const listUpcomingDoctorLeaves = async (doctorId, clinicId) => {
  return findUpcomingLeaves(doctorId, clinicId);
};

export const notifyDoctorDelay = async (user, doctorId, clinicId, delayMinutes) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const today = new Date().toISOString().split("T")[0];

  await upsertDoctorDailyStatus(doctorId, clinicId, today, {
    status: "RUNNING_LATE",
    delayMinutes,
  });

  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      clinicId,
      date: new Date(today),
      status: { in: ["WAITING", "CHECKED_IN"] },
    },
    include: { patient: true },
  });

  emitDoctorDelay(doctorId, clinicId, { delayMinutes, date: today });
  emitLiveDoctorsChanged({ reason: "doctor_delay", doctorId, clinicId });

  await Promise.all(
    appointments
      .filter((a) => a.patient.userId)
      .map((a) =>
        notifyUser({
          userId: a.patient.userId,
          type: "GENERAL",
          title: "Doctor Running Late",
          message: `The doctor is running approximately ${delayMinutes} minutes behind schedule today.`,
          meta: { doctorId, clinicId, date: today, delayMinutes },
        })
      )
  );

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "DOCTOR_STATUS_RUNNING_LATE",
    targetType: "Doctor",
    targetId: doctorId,
    meta: { clinicId, delayMinutes },
  });

  return { notified: appointments.length };
};

export const resumeConsultation = async (user, doctorId, clinicId) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const today = new Date().toISOString().split("T")[0];
  await upsertDoctorDailyStatus(doctorId, clinicId, today, { status: "NORMAL", delayMinutes: null });

  emitDoctorDelay(doctorId, clinicId, { delayMinutes: 0, date: today, resumed: true });
  emitLiveDoctorsChanged({ reason: "doctor_resumed", doctorId, clinicId });

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "DOCTOR_STATUS_RESUMED",
    targetType: "Doctor",
    targetId: doctorId,
    meta: { clinicId },
  });

  return { status: "NORMAL" };
};


// ==============================================
// 🟢 DOCTOR FETCH & STATUS UPDATE SERVICES
// ==============================================

// 1. ALL DOCTORS (সমস্ত ডাক্তার, সাথে তাদের লাইভ স্ট্যাটাস)
export const fetchAllDoctors = async () => {
  return await searchDoctorsAdvanced({});
};

// 2. FEATURED DOCTORS (ফিচারড ডাক্তার)
export const fetchFeaturedDoctors = async () => {
  const doctors = await searchDoctorsAdvancedDB({});
  return doctors
    .filter(doc => doc.isFeatured)
    .sort((a, b) => a.featuredOrder - b.featuredOrder)
    .map(doctor => {
      const status = evaluateDoctorStatus(doctor);
      delete doctor.schedules;
      delete doctor.leaves;
      delete doctor.appointments;
      return { ...doctor, liveStatus: status };
    });
};

// 3. AVAILABLE DOCTORS (যাদের আজকের স্লট এখনো ফুল হয়নি)
export const fetchAvailableDoctors = async () => {
  return await searchDoctorsAdvanced({ availableToday: true });
};

// 4. LIVE DOCTORS (যারা বর্তমানে চেম্বারে রোগী দেখছেন)
export const fetchLiveDoctors = async () => {
  return await searchDoctorsAdvanced({ liveNow: true });
};


// ==============================================

export const updateFeaturedStatus = async (doctorId, isFeatured, featuredOrder) => {
  const doctor = await getDoctorByIdWithClinic(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const dataToUpdate = {
    isFeatured: isFeatured !== undefined ? isFeatured : doctor.isFeatured,
    featuredOrder: featuredOrder !== undefined ? featuredOrder : doctor.featuredOrder
  };

  return await updateDoctorDetails(doctorId, dataToUpdate);
};

export const updateAvailabilityStatus = async (doctorId, isAvailable, userId, userRole) => {
  const doctor = await getDoctorByIdWithClinic(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  let canUpdate = false;
  if (userRole === "SUPER_ADMIN" || userRole === "ADMIN") {
    canUpdate = true;
  } else if (userRole === "DOCTOR" && doctor.userId === userId) {
    canUpdate = true;
  } else if (userRole === "CLINIC" && doctor.clinic.userId === userId) {
    canUpdate = true;
  }

  if (!canUpdate) {
    throw new ApiError(403, "Access Denied: Tumi ei doctor er availability change korte parbe na.");
  }

  const dataToUpdate = {
    isAvailable: isAvailable !== undefined ? isAvailable : !doctor.isAvailable
  };

  const updated = await updateDoctorDetails(doctorId, dataToUpdate);
  emitLiveDoctorsChanged({ reason: "doctor_availability", doctorId });
  return updated;
};

export const uploadProfilePhoto = async (doctorUserId, fileBuffer) => {
  const doctor = await findDoctorByUserId(doctorUserId);
  if (!doctor) throw new ApiError(404, "Doctor profile not found");

  const oldPhoto = doctor.profilePhoto;

  const result = await uploadBufferToCloudinary(fileBuffer, "jeet/doctors");
  
  const updatedDoctor = await updateDoctorProfilePhoto(doctor.id, result.secure_url);
  
  await prisma.user.update({
    where: { id: doctorUserId },
    data: { avatar: result.secure_url }
  });

  if (oldPhoto) await deleteFromCloudinary(oldPhoto);

  return updatedDoctor;
};

export const getDoctorProfileWithClinics = async (doctorId, locationCity = null) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: { select: { name: true, avatar: true, phone: true } },
      clinic: true, 
      clinicAssociations: {
        where: { 
          status: "APPROVED",
          ...(locationCity ? { clinic: { city: locationCity } } : {}) 
        },
        include: { clinic: true }
      }
    }
  });

  if (!doctor) throw new ApiError(404, "Doctor not found");

  const primaryClinic = {
    ...doctor.clinic,
    isPrimary: true,
    associationDetails: {
      fee: doctor.fee,
      startTime: doctor.startTime,
      queueMode: doctor.queueMode
    }
  };

  const associatedClinics = doctor.clinicAssociations.map(assoc => ({
    ...assoc.clinic,
    isPrimary: false,
    associationDetails: {
      fee: assoc.fee,
      dayOfWeek: assoc.dayOfWeek,
      startTime: assoc.startTime,
      endTime: assoc.endTime,
      queueMode: assoc.queueMode
    }
  }));

  const knownClinicIds = new Set([doctor.clinicId, ...associatedClinics.map(c => c.id)].filter(Boolean));

  // FIX: DoctorSchedule (the model that actually drives bookable
  // availability) is a separate doctor<->clinic relationship from
  // DoctorClinicAssociation (a legacy request/approval record). A doctor
  // can have real, active schedules at a clinic that never went through
  // (or has since fallen out of sync with) that association flow — without
  // this, such a clinic silently never appeared in "Chamber Information" /
  // the Doctor -> Clinic booking flow at all, even though patients could
  // book there via the direct clinic page. We add any such clinic here,
  // additively — nothing above is removed or altered.
  const scheduleOnlyClinicRows = await prisma.doctorSchedule.findMany({
    where: {
      doctorId,
      isActive: true,
      clinicId: { notIn: [...knownClinicIds] },
      ...(locationCity ? { clinic: { city: locationCity } } : {}),
    },
    distinct: ["clinicId"],
    include: { clinic: true },
  });

  const scheduleOnlyClinics = scheduleOnlyClinicRows.map(s => ({
    ...s.clinic,
    isPrimary: false,
    associationDetails: {
      // No DoctorClinicAssociation.fee exists for these — fall back to the
      // doctor's base fee, same fallback the frontend already applies
      // (`clinic.associationDetails?.fee || doctor.fee`).
      fee: null,
    },
  }));

  const allClinics = locationCity && doctor.clinic?.city !== locationCity 
    ? [...associatedClinics, ...scheduleOnlyClinics]
    : [primaryClinic, ...associatedClinics, ...scheduleOnlyClinics];

  return { ...doctor, allClinics };
};

export const addSchedule = async (user, doctorId, clinicId, payload) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId); 

  const existingSchedules = await findDoctorSchedules(doctorId, clinicId);
  const conflict = checkScheduleConflict(payload, existingSchedules);

  if (conflict) {
    throw new ApiError(409, `This schedule conflicts with an existing session (${conflict.startTime}-${conflict.endTime})`);
  }

  const created = await createDoctorSchedule({
    doctorId,
    clinicId,
    startTime: payload.startTime,
    endTime: payload.endTime,
    maxPatients: payload.maxPatients,
    recurrenceType: payload.recurrenceType,
    recurrencePattern: payload.recurrencePattern,
    isActive: payload.isActive,
    // Clinic can disable ONLINE booking for this session; walk-in/reception still work.
    onlineBookingEnabled: payload.onlineBookingEnabled ?? true,
  });
  emitLiveDoctorsChanged({ reason: "schedule_added", doctorId, clinicId });
  return created;
};

export const editSchedule = async (user, doctorId, clinicId, scheduleId, payload) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule || schedule.doctorId !== doctorId || schedule.clinicId !== clinicId) {
    throw new ApiError(404, "Schedule not found for this doctor/clinic");
  }

  if (payload.startTime || payload.endTime || payload.recurrencePattern) {
    const existingSchedules = (await findDoctorSchedules(doctorId, clinicId)).filter(s => s.id !== scheduleId);
    
    const candidate = {
      startTime: payload.startTime || schedule.startTime,
      endTime: payload.endTime || schedule.endTime,
      recurrenceType: payload.recurrenceType || schedule.recurrenceType,
      recurrencePattern: payload.recurrencePattern || schedule.recurrencePattern,
    };

    const conflict = checkScheduleConflict(candidate, existingSchedules);
    if (conflict) throw new ApiError(409, `Update conflicts with existing session (${conflict.startTime}-${conflict.endTime})`);
  }

  const updated = await updateDoctorSchedule(scheduleId, payload);
  emitLiveDoctorsChanged({ reason: "schedule_edited", doctorId, clinicId });
  return updated;
};

export const removeSchedule = async (user, doctorId, clinicId, scheduleId) => {
  await assertDoctorClinicManageAccess(user, doctorId, clinicId);

  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule || schedule.doctorId !== doctorId || schedule.clinicId !== clinicId) {
    throw new ApiError(404, "Schedule not found");
  }

  await deleteDoctorSchedule(scheduleId);
  emitLiveDoctorsChanged({ reason: "schedule_removed", doctorId, clinicId });
  return { deleted: true };
};

export const listSchedules = async (doctorId, clinicId) => {
  return findDoctorSchedules(doctorId, clinicId);
};

export const getExceptionsForSchedulesOnDate = async (scheduleIds, date) => {
  return listExceptionsForSchedulesOnDate(scheduleIds, date);
};

export const setScheduleException = async (user, scheduleId, payload) => {
  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule) throw new ApiError(404, "Schedule not found");
  await assertDoctorClinicManageAccess(user, schedule.doctorId, schedule.clinicId);

  const exception = await upsertScheduleException(scheduleId, payload.date, {
    isCancelled: !!payload.isCancelled,
    overrideStartTime: payload.overrideStartTime || null,
    overrideEndTime: payload.overrideEndTime || null,
    overrideMaxPatients: payload.overrideMaxPatients ?? null,
    reason: payload.reason || null,
  });

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: exception.isCancelled ? "SCHEDULE_CANCELLED_FOR_DATE" : "SCHEDULE_OVERRIDDEN_FOR_DATE",
    targetType: "DoctorSchedule",
    targetId: scheduleId,
    meta: { date: payload.date, doctorId: schedule.doctorId, clinicId: schedule.clinicId },
  });

  return exception;
};

export const getScheduleExceptions = async (user, scheduleId) => {
  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule) throw new ApiError(404, "Schedule not found");
  await assertDoctorClinicManageAccess(user, schedule.doctorId, schedule.clinicId);
  return listScheduleExceptions(scheduleId);
};

export const removeScheduleException = async (user, scheduleId, exceptionId) => {
  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule) throw new ApiError(404, "Schedule not found");
  await assertDoctorClinicManageAccess(user, schedule.doctorId, schedule.clinicId);
  await deleteScheduleException(exceptionId);

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "SCHEDULE_EXCEPTION_REMOVED",
    targetType: "DoctorSchedule",
    targetId: scheduleId,
  });

  return { deleted: true };
};

// === NEW: Step 29 Advanced Search ===
export const searchDoctorsAdvanced = async (filters) => {
  const doctors = await searchDoctorsAdvancedDB(filters);

  let mappedDoctors = doctors.map(doctor => {
    const status = evaluateDoctorStatus(doctor);
    
    delete doctor.schedules;
    delete doctor.leaves;
    delete doctor.appointments;
    
    return { ...doctor, liveStatus: status };
  });

  // 🟢 FIX: Live এবং Available এর ফিল্টার আলাদা করা হলো
  if (filters.liveNow === true) {
    // শুধুমাত্র যারা এই মুহূর্তে Live আছে
    mappedDoctors = mappedDoctors.filter(doc => doc.liveStatus?.isLive === true);
  } else if (filters.availableToday === true) {
    // শুধুমাত্র যাদের আজকের স্লট অ্যাভেইলেবল আছে
    mappedDoctors = mappedDoctors.filter(doc => doc.liveStatus?.isAvailable === true);
  }

  return mappedDoctors;
};
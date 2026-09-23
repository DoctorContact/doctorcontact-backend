import prisma from "../../config/db.config.js";
import * as clinicRepo from "./clinic.repository.js";
import ApiError from "../../utils/apiError.js";
import { hashPassword } from "../auth/auth.helper.js";
import { findUserByEmail, findUserByPhone, updateUserPassword } from "../auth/auth.repository.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import { notifyUser } from "../notification/notification.service.js";
import { respondToDoctorRequest as respondToDoctorRequestCore } from "../doctor/doctor.service.js";
import { findApprovedAssociationsForDoctor } from "../doctor/doctor.repository.js";
import { evaluateClinicAvailability } from "./clinic.helper.js";
import { logAudit } from "../audit/audit.service.js";
import { emitLiveDoctorsChanged } from "../../sockets/doctor.socket.js";

// 🟢 ISSUE 1 FIX: resolveDayOfWeek helper
const DAY_OF_WEEK_BY_JS_INDEX = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
];

const resolveDayOfWeek = (payload) => {
  if (payload.dayOfWeek) return payload.dayOfWeek;

  if (payload.recurrenceType === "WEEKLY" && payload.recurrencePattern?.days?.length > 0) {
    return payload.recurrencePattern.days[0];
  }

  if (payload.recurrenceType === "MONTHLY_WEEKDAY" && payload.recurrencePattern?.day) {
    return payload.recurrencePattern.day;
  }

  if (payload.recurrenceType === "SPECIFIC_DATE" && payload.recurrencePattern?.exactDate) {
    const parsed = new Date(payload.recurrencePattern.exactDate);
    if (!isNaN(parsed.getTime())) return DAY_OF_WEEK_BY_JS_INDEX[parsed.getDay()];
  }

  return DAY_OF_WEEK_BY_JS_INDEX[new Date().getDay()];
};

export const lookupDoctorByEmail = async (email) => {
  const user = await findUserByEmail(email);
  if (!user) return null; 
  if (user.role !== "DOCTOR") throw new ApiError(400, "User exists but is not registered as a DOCTOR");

  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
      specializations: { include: { specialization: true } }
    }
  });

  return doctor;
};

export const getMyClinicProfile = async (userId) => {
  const clinic = await clinicRepo.findClinicByUserId(userId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinic;
};

export const updateMyClinicProfile = async (userId, data) => {
  const clinic = await clinicRepo.findClinicByUserId(userId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.updateClinicProfile(clinic.id, data);
};

export const addDoctor = async (clinicUserId, payload) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  if (!clinic.isApproved) throw new ApiError(403, "Your clinic is not yet approved by admin");

  const existingUser = payload.email
    ? await findUserByEmail(payload.email)
    : payload.phone
    ? await findUserByPhone(payload.phone)
    : null;

  if (existingUser) {
    if (existingUser.role !== "DOCTOR") {
      throw new ApiError(409, "A user with this email/phone exists but is not registered as a DOCTOR.");
    }

    const existingDoctor = await prisma.doctor.findUnique({ where: { userId: existingUser.id } });
    if (!existingDoctor) throw new ApiError(500, "Doctor profile missing for this user.");

    // 🟢 ISSUE 8 FIX: Check only active associations (PENDING or APPROVED)
    const existingAssoc = await prisma.doctorClinicAssociation.findFirst({
      where: { 
        doctorId: existingDoctor.id, 
        clinicId: clinic.id,
        status: { in: ["PENDING", "APPROVED"] } 
      }
    });

    if (existingDoctor.clinicId === clinic.id || (existingAssoc && existingAssoc.status === "APPROVED")) {
      const { password: _pw, refreshToken: _rt, ...safeUser } = existingUser;
      return { 
        user: safeUser, 
        doctor: existingDoctor, 
        association: existingAssoc || null, 
        isExisting: true,
        message: "Doctor is already in your clinic. Proceeding to create schedule."
      };
    }

    if (existingAssoc && existingAssoc.status === "PENDING") {
      throw new ApiError(409, `A PENDING connection request already exists. Please wait for the doctor to respond.`);
    }

    if (!payload.startTime || !payload.endTime) {
      throw new ApiError(400, "startTime and endTime are required to send a schedule request to this doctor.");
    }

    const association = await prisma.doctorClinicAssociation.create({
      data: {
        doctorId: existingDoctor.id,
        clinicId: clinic.id,
        fee: payload.fee,
        dayOfWeek: resolveDayOfWeek(payload),
        startTime: payload.startTime,
        endTime: payload.endTime,
        status: "PENDING",
        requestedBy: "CLINIC",
      }
    });

    await notifyUser({
      userId: existingUser.id,
      type: "CONNECTION_REQUEST_RECEIVED",
      title: "New Clinic Connection Request",
      message: `${clinic.clinicName} wants to add you as a doctor at their clinic. Review and respond to the request.`,
      meta: { clinicId: clinic.id, associationId: association.id },
    });

    await logAudit({
      actorUserId: clinicUserId,
      actorRole: "CLINIC",
      action: "DOCTOR_CONNECTION_REQUESTED",
      targetType: "DoctorClinicAssociation",
      targetId: association.id,
      meta: { doctorId: existingDoctor.id, clinicId: clinic.id },
    });

    const { password: _pw, refreshToken: _rt, ...safeUser } = existingUser;
    return {
      user: safeUser,
      doctor: existingDoctor,
      association,
      isExisting: true,
      message: "A request has been sent to this doctor. They'll appear in your clinic once they accept it.",
    };
  }

  // === Standard flow for entirely new Doctor ===
  const hashedPassword = await hashPassword(payload.password);
  
  const { 
    specialization, specializationIds, qualification, experience, fee, 
    startTime, endTime, dayOfWeek, recurrenceType, recurrencePattern, 
    maxPatients, medicalSystem, 
    ...userFields 
  } = payload;
  
  const { user, doctor } = await clinicRepo.createDoctorWithUser({ 
    userData: { ...userFields, password: hashedPassword }, 
    doctorData: { specialization, specializationIds, qualification, experience, fee, startTime, medicalSystem }, 
    clinicId: clinic.id 
  });
  
  const { password, refreshToken, ...safeUser } = user;
  return { user: safeUser, doctor, isExisting: false };
};

export const editDoctor = async (clinicUserId, doctorId, data) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  
  const doctor = await clinicRepo.findDoctorById(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");
  
  return clinicRepo.updateDoctor(doctorId, data, clinic.id);
};

export const removeDoctorFromClinic = async (clinicUserId, doctorId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");

  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const isNative = doctor.clinicId === clinic.id;
  
  const association = await prisma.doctorClinicAssociation.findFirst({
    where: { doctorId: doctor.id, clinicId: clinic.id }
  });

  if (!isNative && !association) {
    throw new ApiError(404, "Doctor is not associated with your clinic");
  }

  // Execute atomic and safe removal in repository
  await clinicRepo.removeDoctorFromClinicRepo(doctorId, clinic.id);

  // Emit socket event to clear them from live views
  emitLiveDoctorsChanged({ reason: "doctor_removed_from_clinic", doctorId, clinicId: clinic.id });

  return true;
};

export const addReceptionist = async (clinicUserId, payload) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  if (!clinic.isApproved) throw new ApiError(403, "Your clinic is not yet approved by admin");
  if (payload.email && (await findUserByEmail(payload.email))) {
    throw new ApiError(409, "A user with this email already exists");
  }
  if (payload.phone && (await findUserByPhone(payload.phone))) {
    throw new ApiError(409, "A user with this phone number already exists");
  }
  const hashedPassword = await hashPassword(payload.password);
  const { user, receptionist } = await clinicRepo.createReceptionistWithUser({ userData: { ...payload, password: hashedPassword }, clinicId: clinic.id });
  const { password, refreshToken, ...safeUser } = user;
  return { user: safeUser, receptionist };
};

export const listMyDoctors = async (clinicUserId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.findDoctorsByClinic(clinic.id);
};

export const listMyReceptionists = async (clinicUserId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.findReceptionistsByClinic(clinic.id);
};

export const assignDoctorsToReceptionistForClinic = async (clinicUserId, { receptionistId, doctorIds }) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  const receptionist = await clinicRepo.findReceptionistById(receptionistId);
  if (!receptionist || receptionist.clinicId !== clinic.id) throw new ApiError(404, "Receptionist not found in your clinic");

  for (const doctorId of doctorIds) {
    const doctor = await clinicRepo.findDoctorById(doctorId);
    if (!doctor) throw new ApiError(404, `Doctor ${doctorId} not found`);
    if (doctor.clinicId !== clinic.id) {
      const approvedAssociations = await findApprovedAssociationsForDoctor(doctorId);
      const hasApprovedAssociation = approvedAssociations.some((a) => a.clinicId === clinic.id);
      if (!hasApprovedAssociation) throw new ApiError(400, `Doctor ${doctorId} does not belong to your clinic`);
    }
  }
  return clinicRepo.assignDoctorsToReceptionist(receptionistId, clinic.id, doctorIds);
};

export const getMyAssignedDoctors = async (receptionistUserId) => {
  const receptionist = await clinicRepo.findAssignedDoctorsForReceptionistUser(receptionistUserId);
  if (!receptionist) throw new ApiError(404, "Receptionist profile not found");
  return receptionist.assignedDoctors.map((rd) => ({ doctorId: rd.doctor.id, name: rd.doctor.user.name, specialization: rd.doctor.specialization, clinicId: rd.clinic.id, clinicName: rd.clinic.clinicName }));
};

export const changeStaffPassword = async (clinicUserId, { userId, newPassword }) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  const staffRole = await clinicRepo.findDoctorOrReceptionistUser(userId, clinic.id);
  if (!staffRole) throw new ApiError(404, "Doctor or Receptionist not found in your clinic");
  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(userId, hashedPassword);
};

export const searchByName = async (name) => {
  return clinicRepo.searchClinicsByName(name);
};

export const respondToDoctorRequest = async (clinicUserId, associationId, action) => {
  return respondToDoctorRequestCore(clinicUserId, associationId, action);
};

export const uploadLogo = async (clinicUserId, fileBuffer) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  const oldLogo = clinic.logo;
  const result = await uploadBufferToCloudinary(fileBuffer, "jeet/clinics");
  const updated = await clinicRepo.updateClinicLogo(clinic.id, result.secure_url);
  if (oldLogo) await deleteFromCloudinary(oldLogo);
  return updated;
};

export const setWorkingHours = async (clinicUserId, workingHours) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.upsertWorkingHours(clinic.id, workingHours);
};

export const getWorkingHours = async (clinicUserId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.findWorkingHours(clinic.id);
};

export const addClinicHoliday = async (clinicUserId, { date, reason }) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  const existing = await clinicRepo.findHolidayForDate(clinic.id, date);
  if (existing) throw new ApiError(409, "A holiday is already set for this date");
  const holiday = await clinicRepo.addHoliday(clinic.id, date, reason);

  await logAudit({
    actorUserId: clinicUserId,
    actorRole: "CLINIC",
    action: "CLINIC_MARKED_CLOSED",
    targetType: "Clinic",
    targetId: clinic.id,
    meta: { date, reason },
  });

  return holiday;
};

export const removeClinicHoliday = async (clinicUserId, holidayId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  const result = await clinicRepo.removeHoliday(clinic.id, holidayId);
  if (result.count === 0) throw new ApiError(404, "Holiday not found");
  return { deleted: true };
};

export const listClinicHolidays = async (clinicUserId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.findHolidays(clinic.id);
};

export const toggleOnlineConsultation = async (clinicUserId, enabled) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.setOnlineConsultationEnabled(clinic.id, enabled);
};

export const getMyReceivedRequests = async (clinicUserId) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.findReceivedRequestsForClinic(clinic.id);
};

export const toggleAvailability = async (clinicUserId, isAvailableToday) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.updateClinicAvailability(clinic.id, isAvailableToday);
};

export const toggleAutoFollowup = async (clinicUserId, enabled) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");
  return clinicRepo.setAutoFollowupEnabled(clinic.id, enabled);
};

export const searchClinicsAdvanced = async (filters) => {
  const clinics = await clinicRepo.searchClinicsAdvancedDB(filters);
  return clinics.map((clinic) => ({
    ...clinic,
    doctorsCount: clinic._count.doctors,
    _count: undefined,
  }));
};

export const fetchAllClinics = async () => {
  const clinics = await clinicRepo.findAllApprovedClinics();
  return clinics.map(clinic => ({
    ...clinic,
    availability: evaluateClinicAvailability(clinic), 
    doctorsCount: clinic._count.doctors + clinic._count.doctorAssociations,
    _count: undefined
  }));
};

export const fetchFeaturedClinics = async () => {
  const clinics = await clinicRepo.findFeaturedClinics();
  return clinics.map(clinic => ({
    ...clinic,
    availability: evaluateClinicAvailability(clinic), 
    doctorsCount: clinic._count.doctors + clinic._count.doctorAssociations,
    _count: undefined
  }));
};

export const fetchClinicProfileById = async (id) => {
  const clinic = await clinicRepo.getClinicProfileWithDoctorsRepo(id);
  if (!clinic) throw new ApiError(404, "Clinic not found");

  const primaryDoctors = clinic.doctors.map(doc => ({
    ...doc,
    isPrimary: true,
    associationDetails: { 
      fee: doc.fee, 
      startTime: doc.startTime, 
      queueMode: doc.queueMode,
      onlineBookingEnabled: doc.onlineBookingEnabled 
    }
  }));

  const associatedDoctors = clinic.doctorAssociations.map(assoc => ({
    ...assoc.doctor,
    isPrimary: false,
    associationDetails: {
      fee: assoc.fee,
      dayOfWeek: assoc.dayOfWeek,
      startTime: assoc.startTime,
      endTime: assoc.endTime,
      queueMode: assoc.queueMode,
      onlineBookingEnabled: assoc.onlineBookingEnabled 
    }
  }));

  return {
    ...clinic,
    availability: evaluateClinicAvailability(clinic),
    allDoctors: [...primaryDoctors, ...associatedDoctors]
  };
};

export const toggleFeaturedStatus = async (clinicId, isFeatured, featuredOrder) => {
  const clinicExists = await clinicRepo.findClinicById(clinicId);
  if (!clinicExists) throw new ApiError(404, "Clinic not found");

  return clinicRepo.updateClinicFeaturedStatus(clinicId, {
    isFeatured: isFeatured !== undefined ? isFeatured : clinicExists.isFeatured,
    featuredOrder: featuredOrder !== undefined ? featuredOrder : clinicExists.featuredOrder
  });
};

export const toggleDoctorOnlineBookingStatus = async (clinicUserId, doctorId, onlineBookingEnabled) => {
  const clinic = await clinicRepo.findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");

  const doctor = await clinicRepo.findDoctorById(doctorId);
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const isPrimary = doctor.clinicId === clinic.id;

  return clinicRepo.updateDoctorOnlineBookingStatus(doctorId, clinic.id, isPrimary, onlineBookingEnabled);
};
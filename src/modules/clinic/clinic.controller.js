import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import * as clinicService from "./clinic.service.js";
import {
  updateClinicProfileSchema, createDoctorSchema, createReceptionistSchema, assignDoctorsSchema,
  changeStaffPasswordSchema, updateDoctorSchema, searchClinicsByNameSchema, setWorkingHoursSchema,
  addHolidaySchema, toggleOnlineConsultationSchema, toggleAvailabilitySchema
} from "./clinic.validation.js";
import { respondToRequestSchema } from "../doctor/doctor.validation.js";

// === NEW: Lookup Doctor by Email ===
export const lookupDoctor = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) throw new ApiError(400, "Email is required to lookup doctor");
  
  const doctor = await clinicService.lookupDoctorByEmail(email);
  res.status(200).json(new ApiResponse(true, "Doctor lookup completed", { doctor }));
});

export const getMyProfile = asyncHandler(async (req, res) => {
  const clinic = await clinicService.getMyClinicProfile(req.user.id);
  res.status(200).json(new ApiResponse(true, "Clinic profile fetched", { clinic }));
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const data = updateClinicProfileSchema.parse(req.body);
  const clinic = await clinicService.updateMyClinicProfile(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Clinic profile updated", { clinic }));
});

// 🟢 FIXED: Dynamic Password Enforcement
export const addDoctor = asyncHandler(async (req, res) => {
  // 1. Zod parses the body (password is now .optional() in Zod, so this won't crash)
  const data = createDoctorSchema.parse(req.body);

  // 2. Check if doctor already exists
  let isExisting = false;
  try {
    const existingDoc = await clinicService.lookupDoctorByEmail(data.email);
    if (existingDoc) isExisting = true;
  } catch (error) {
    // If service throws a 404 Not Found error, the doctor does not exist yet
    isExisting = false;
  }

  // 3. Manually enforce password ONLY for brand new doctors
  if (!isExisting && !data.password) {
    throw new ApiError(400, "Password is strictly required to create a new doctor account.");
  }

  // 4. Proceed to Service (Service will either create the user or just link the existing one)
  const result = await clinicService.addDoctor(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Doctor added successfully", result));
});

export const editDoctor = asyncHandler(async (req, res) => {
  const data = updateDoctorSchema.parse(req.body);
  const doctor = await clinicService.editDoctor(req.user.id, req.params.doctorId, data);
  res.status(200).json(new ApiResponse(true, "Doctor updated successfully", { doctor }));
});

// === NEW: Remove Doctor from Clinic ===
export const removeDoctor = asyncHandler(async (req, res) => {
  await clinicService.removeDoctorFromClinic(req.user.id, req.params.doctorId);
  res.status(200).json(new ApiResponse(true, "Doctor removed from clinic successfully"));
});

export const addReceptionist = asyncHandler(async (req, res) => {
  const data = createReceptionistSchema.parse(req.body);
  const result = await clinicService.addReceptionist(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Receptionist created successfully", result));
});

export const listDoctors = asyncHandler(async (req, res) => {
  const doctors = await clinicService.listMyDoctors(req.user.id);
  res.status(200).json(new ApiResponse(true, "Doctors fetched", { doctors }));
});

export const listReceptionists = asyncHandler(async (req, res) => {
  const receptionists = await clinicService.listMyReceptionists(req.user.id);
  res.status(200).json(new ApiResponse(true, "Receptionists fetched", { receptionists }));
});

export const assignDoctorsToReceptionist = asyncHandler(async (req, res) => {
  const data = assignDoctorsSchema.parse(req.body);
  const result = await clinicService.assignDoctorsToReceptionistForClinic(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Doctors assigned successfully", { assignments: result }));
});

export const getMyAssignedDoctors = asyncHandler(async (req, res) => {
  const doctors = await clinicService.getMyAssignedDoctors(req.user.id);
  res.status(200).json(new ApiResponse(true, "Assigned doctors fetched", { doctors }));
});

export const changeStaffPassword = asyncHandler(async (req, res) => {
  const data = changeStaffPasswordSchema.parse(req.body);
  await clinicService.changeStaffPassword(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Password updated successfully"));
});

export const searchByName = asyncHandler(async (req, res) => {
  const { name } = searchClinicsByNameSchema.parse(req.query);
  const clinics = await clinicService.searchByName(name);
  res.status(200).json(new ApiResponse(true, "Clinics fetched", { clinics }));
});

export const respondToDoctorRequest = asyncHandler(async (req, res) => {
  const { action } = respondToRequestSchema.parse(req.body);
  const association = await clinicService.respondToDoctorRequest(req.user.id, req.params.associationId, action);
  res.status(200).json(new ApiResponse(true, `Request ${action === "ACCEPT" ? "approved" : "rejected"}`, { association }));
});

export const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image file provided");
  const clinic = await clinicService.uploadLogo(req.user.id, req.file.buffer);
  res.status(200).json(new ApiResponse(true, "Logo uploaded", { clinic }));
});

export const setWorkingHours = asyncHandler(async (req, res) => {
  const { workingHours } = setWorkingHoursSchema.parse(req.body);
  const result = await clinicService.setWorkingHours(req.user.id, workingHours);
  res.status(200).json(new ApiResponse(true, "Working hours updated", { workingHours: result }));
});

export const getWorkingHours = asyncHandler(async (req, res) => {
  const workingHours = await clinicService.getWorkingHours(req.user.id);
  res.status(200).json(new ApiResponse(true, "Working hours fetched", { workingHours }));
});

export const addHoliday = asyncHandler(async (req, res) => {
  const data = addHolidaySchema.parse(req.body);
  const holiday = await clinicService.addClinicHoliday(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Holiday added", { holiday }));
});

export const removeHoliday = asyncHandler(async (req, res) => {
  await clinicService.removeClinicHoliday(req.user.id, req.params.holidayId);
  res.status(200).json(new ApiResponse(true, "Holiday removed"));
});

export const listHolidays = asyncHandler(async (req, res) => {
  const holidays = await clinicService.listClinicHolidays(req.user.id);
  res.status(200).json(new ApiResponse(true, "Holidays fetched", { holidays }));
});

export const toggleOnlineConsultation = asyncHandler(async (req, res) => {
  const { enabled } = toggleOnlineConsultationSchema.parse(req.body);
  const clinic = await clinicService.toggleOnlineConsultation(req.user.id, enabled);
  res.status(200).json(new ApiResponse(true, `Online consultation ${enabled ? "enabled" : "disabled"}`, { clinic }));
});

export const getMyReceivedRequests = asyncHandler(async (req, res) => {
  const requests = await clinicService.getMyReceivedRequests(req.user.id);
  res.status(200).json(new ApiResponse(true, "Received requests fetched", { requests }));
});

// ==========================================
// PUBLIC CONTROLLERS
// ==========================================
export const getAllClinics = asyncHandler(async (req, res) => {
  const { available, query, city, specializationId } = req.query;

  if (query || city || specializationId) {
    const clinics = await clinicService.searchClinicsAdvanced({ query, city, specializationId });
    return res.status(200).json(new ApiResponse(true, "Clinics fetched", { clinics }));
  }

  let clinics = await clinicService.fetchAllClinics();

  if (available === 'true') {
    clinics = clinics.filter(clinic => clinic.availability?.isAvailable);
  }

  res.status(200).json(new ApiResponse(true, "All clinics fetched successfully", clinics));
});

export const getFeaturedClinics = asyncHandler(async (req, res) => {
  const clinics = await clinicService.fetchFeaturedClinics();
  res.status(200).json(new ApiResponse(true, "Featured clinics fetched successfully", clinics));
});

export const getClinicById = asyncHandler(async (req, res) => {
  const clinic = await clinicService.fetchClinicProfileById(req.params.id);
  res.status(200).json(new ApiResponse(true, "Clinic profile fetched successfully", clinic));
});

export const toggleClinicFeaturedStatus = asyncHandler(async (req, res) => {
  const { isFeatured, featuredOrder } = req.body;
  const updatedClinic = await clinicService.toggleFeaturedStatus(req.params.clinicId, isFeatured, featuredOrder);
  res.status(200).json(new ApiResponse(true, "Clinic featured status updated", updatedClinic));
});

export const toggleAvailability = asyncHandler(async (req, res) => {
  const { isAvailableToday } = toggleAvailabilitySchema.parse(req.body);
  const clinic = await clinicService.toggleAvailability(req.user.id, isAvailableToday);
  res.status(200).json(new ApiResponse(true, `Clinic availability marked as ${isAvailableToday ? 'Open' : 'Closed'}`, { clinic }));
});
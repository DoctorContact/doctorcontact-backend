import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as patientService from "./patient.service.js";
import {
  searchPatientSchema,
  createGuestPatientSchema,
  updatePatientProfileSchema,
} from "./patient.validation.js";

export const searchPatient = asyncHandler(async (req, res) => {
  const { phone } = searchPatientSchema.parse(req.query);
  const patient = await patientService.searchPatientByPhone(phone);

  if (!patient) {
    return res
      .status(200)
      .json(new ApiResponse(true, "No patient found with this phone number", { patient: null }));
  }

  res.status(200).json(new ApiResponse(true, "Patient found", { patient }));
});

export const createGuestPatient = asyncHandler(async (req, res) => {
  const data = createGuestPatientSchema.parse(req.body);
  const patient = await patientService.createGuest(data);
  res.status(201).json(new ApiResponse(true, "Guest patient created successfully", { patient }));
});

export const getMyProfile = asyncHandler(async (req, res) => {
  const patient = await patientService.getMyProfile(req.user.id);
  res.status(200).json(new ApiResponse(true, "Patient profile fetched", { patient }));
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const data = updatePatientProfileSchema.parse(req.body);
  const patient = await patientService.updateMyProfile(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Profile updated successfully", { patient }));
});

// NOTE: this used to run its own ad-hoc, unauthenticated query directly
// against the User table (unnormalized phone, no fallback to guest patients
// whose phone lives on the Patient row). That's why some clinics saw "no
// patient found" for people who actually did have a record — this endpoint
// disagreed with the canonical /patient/search route. It's now a thin,
// backward-compatible alias for the same vetted, normalized lookup so every
// screen in the app gets identical, correct results.
export const searchByPhone = asyncHandler(async (req, res) => {
  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json(new ApiResponse(false, "Phone number is required"));
  }

  const patient = await patientService.searchPatientByPhone(phone);
  res.status(200).json(new ApiResponse(true, patient ? "Patient found" : "No patient found", { patient }));
});

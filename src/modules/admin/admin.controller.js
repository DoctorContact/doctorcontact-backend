import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as adminService from "./admin.service.js";
import { updateClinicAdminSchema } from "./admin.validation.js";
import {
  listUsersQuerySchema,
  toggleUserStatusSchema,
  listClinicsQuerySchema,
} from "./admin.validation.js";

import { updateSettingsSchema } from "./admin.validation.js";
import { createAdminSchema, createClinicSchema } from "./admin.validation.js";
import { createDiagnosticCenterSchema, setFeaturedDoctorSchema } from "./admin.validation.js";
import { createDoctorSchema } from "./admin.validation.js";

export const listClinics = asyncHandler(async (req, res) => {
  const query = listClinicsQuerySchema.parse(req.query);
  const result = await adminService.listClinics(query);
  res.status(200).json(new ApiResponse(true, "Clinics fetched", result));
});

export const approveClinic = asyncHandler(async (req, res) => {
  const clinic = await adminService.approveClinic(req.params.clinicId);
  res.status(200).json(new ApiResponse(true, "Clinic approved successfully", { clinic }));
});

export const revokeClinicApproval = asyncHandler(async (req, res) => {
  const clinic = await adminService.revokeClinicApproval(req.params.clinicId);
  res.status(200).json(new ApiResponse(true, "Clinic approval revoked", { clinic }));
});

export const listUnverifiedDoctors = asyncHandler(async (req, res) => {
  const doctors = await adminService.listUnverifiedDoctors();
  res.status(200).json(new ApiResponse(true, "Unverified doctors fetched", { doctors }));
});

export const verifyDoctor = asyncHandler(async (req, res) => {
  const doctor = await adminService.verifyDoctor(req.params.doctorId);
  res.status(200).json(new ApiResponse(true, "Doctor verified successfully", { doctor }));
});

export const listUsers = asyncHandler(async (req, res) => {
  const query = listUsersQuerySchema.parse(req.query);
  const result = await adminService.listUsers(query);
  res.status(200).json(new ApiResponse(true, "Users fetched", result));
});

export const toggleUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = toggleUserStatusSchema.parse(req.body);
  const user = await adminService.toggleUserStatus(req.params.userId, isActive);
  res
    .status(200)
    .json(new ApiResponse(true, `User ${isActive ? "activated" : "deactivated"} successfully`, { user }));
});

export const getStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getStats();
  res.status(200).json(new ApiResponse(true, "Platform stats fetched", { stats }));
});

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await adminService.getSettings();
  res.status(200).json(new ApiResponse(true, "Platform settings fetched", { settings }));
});

export const updateSettings = asyncHandler(async (req, res) => {
  const data = updateSettingsSchema.parse(req.body);
  const settings = await adminService.updateSettings(data);
  res.status(200).json(new ApiResponse(true, "Platform settings updated", { settings }));
});

// super admin create admin
export const createAdmin = asyncHandler(async (req, res) => {
  const data = createAdminSchema.parse(req.body);
  const admin = await adminService.createAdmin(data);
  res.status(201).json(new ApiResponse(true, "Admin account created successfully", { admin }));
});

export const createClinic = asyncHandler(async (req, res) => {
  const data = createClinicSchema.parse(req.body);
  const result = await adminService.createClinic(data);
  res.status(201).json(new ApiResponse(true, "Clinic account created successfully", result));
});

export const createDoctor = asyncHandler(async (req, res) => {
  const data = createDoctorSchema.parse(req.body);
  const result = await adminService.createDoctor(data);
  res.status(201).json(new ApiResponse(true, "Doctor account created successfully", result));
});

export const listBookings = asyncHandler(async (req, res) => {
  const { clinicId, status, from, to, page = 1, limit = 20 } = req.query;
  const result = await adminService.listAllBookings({
    clinicId: clinicId || undefined,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
    page: Number(page),
    limit: Number(limit),
  });
  res.status(200).json(new ApiResponse(true, "Bookings fetched", result));
});



export const createDiagnosticCenter = asyncHandler(async (req, res) => {
  const data = createDiagnosticCenterSchema.parse(req.body);
  const result = await adminService.createDiagnosticCenter(data);
  res.status(201).json(new ApiResponse(true, "Diagnostic center created successfully", result));
});

export const listDiagnosticCenters = asyncHandler(async (req, res) => {
  const { isApproved, page = 1, limit = 20 } = req.query;
  const result = await adminService.listDiagnosticCenters({
    isApproved: isApproved === undefined ? undefined : isApproved === "true",
    page: Number(page),
    limit: Number(limit),
  });
  res.status(200).json(new ApiResponse(true, "Diagnostic centers fetched", { centers: result }));
});

export const approveDiagnosticCenter = asyncHandler(async (req, res) => {
  const center = await adminService.approveDiagnosticCenter(req.params.centerId);
  res.status(200).json(new ApiResponse(true, "Diagnostic center approved", { center }));
});

export const revokeDiagnosticCenter = asyncHandler(async (req, res) => {
  const center = await adminService.revokeDiagnosticCenterApproval(req.params.centerId);
  res.status(200).json(new ApiResponse(true, "Diagnostic center approval revoked", { center }));
});



export const setFeaturedDoctor = asyncHandler(async (req, res) => {
  const { isFeatured, featuredOrder } = setFeaturedDoctorSchema.parse(req.body);
  const doctor = await adminService.setDoctorFeaturedStatus(req.params.doctorId, isFeatured, featuredOrder);
  res
    .status(200)
    .json(new ApiResponse(true, `Doctor ${isFeatured ? "featured" : "unfeatured"} successfully`, { doctor }));
});

export const listFeaturedDoctors = asyncHandler(async (req, res) => {
  const doctors = await adminService.listFeaturedDoctors();
  res.status(200).json(new ApiResponse(true, "Featured doctors fetched", { doctors }));
});

// === NEW: Step 24 Clinic Management ===

export const updateClinic = asyncHandler(async (req, res) => {
  const data = updateClinicAdminSchema.parse(req.body);
  const clinic = await adminService.editClinic(req.params.clinicId, data);
  res.status(200).json(new ApiResponse(true, "Clinic updated successfully", { clinic }));
});

export const deactivateClinic = asyncHandler(async (req, res) => {
  await adminService.deactivateClinic(req.params.clinicId);
  res.status(200).json(new ApiResponse(true, "Clinic deactivated successfully"));
});
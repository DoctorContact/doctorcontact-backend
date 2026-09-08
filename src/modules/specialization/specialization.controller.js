import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import { uploadBufferToCloudinary } from "../../utils/cloudinaryUpload.js";
import * as specializationService from "./specialization.service.js";
import {
  createSpecializationSchema,
  updateSpecializationSchema,
} from "./specialization.validation.js";

// Fetch specializations. Public callers get only active ones; an admin can pass
// ?all=true to also see deactivated entries for management.
export const getAllSpecializations = asyncHandler(async (req, res) => {
  const includeInactive =
    req.query.all === "true" &&
    (req.user?.role === "SUPER_ADMIN" || req.user?.role === "ADMIN");

  const specializations = await specializationService.fetchSpecializations(!includeInactive);
  res.status(200).json(new ApiResponse(true, "Specializations fetched", { specializations }));
});

// Super Admin / Admin creates a new specialization with an optional icon image.
export const createSpecialization = asyncHandler(async (req, res) => {
  const data = createSpecializationSchema.parse(req.body);

  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, "jeet/categories");
    data.iconUrl = result.secure_url;
  }

  const specialization = await specializationService.addSpecialization(data);
  res.status(201).json(new ApiResponse(true, "Specialization added successfully", { specialization }));
});

// Super Admin / Admin edits a specialization (name / description / icon) or
// activates/deactivates it (master requirement #9).
export const updateSpecialization = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ApiError(400, "Specialization id is required");

  const raw = { ...req.body };
  if (typeof raw.isActive === "string") raw.isActive = raw.isActive === "true";
  const data = updateSpecializationSchema.parse(raw);

  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, "jeet/categories");
    data.iconUrl = result.secure_url;
  }

  const specialization = await specializationService.editSpecialization(id, data);
  res.status(200).json(new ApiResponse(true, "Specialization updated", { specialization }));
});

import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as ambulanceService from "./ambulance.service.js";
import { addAmbulanceSchema, updateAmbulanceSchema } from "./ambulance.validation.js";

export const addAmbulance = asyncHandler(async (req, res) => {
  const validatedData = addAmbulanceSchema.parse(req.body);
  const result = await ambulanceService.addAmbulance(validatedData);
  res.status(201).json(new ApiResponse(true, "Ambulance added successfully", result));
});

export const getAmbulances = asyncHandler(async (req, res) => {
  // 🟢 FIX: Check if the request is coming from an Admin
  // (If req.user is undefined, it means it's a public request)
  const isAdmin = req.user && (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN");
  
  const result = await ambulanceService.getAllAmbulances(isAdmin);
  res.status(200).json(new ApiResponse(true, "Ambulances fetched successfully", result));
});

export const updateAmbulance = asyncHandler(async (req, res) => {
  const validatedData = updateAmbulanceSchema.parse(req.body);
  const result = await ambulanceService.editAmbulance(req.params.id, validatedData);
  res.status(200).json(new ApiResponse(true, "Ambulance updated successfully", result));
});

export const deleteAmbulance = asyncHandler(async (req, res) => {
  await ambulanceService.removeAmbulance(req.params.id);
  res.status(200).json(new ApiResponse(true, "Ambulance deleted successfully"));
});
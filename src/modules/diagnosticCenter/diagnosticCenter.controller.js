import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import * as centerService from "./diagnosticCenter.service.js";
import { updateCenterProfileSchema, createStaffSchema, changeStaffPasswordSchema, addCenterTestSchema, 
  updateCenterTestSchema } from "./diagnosticCenter.validation.js";

export const getMyProfile = asyncHandler(async (req, res) => {
  const center = await centerService.getMyProfile(req.user.id);
  res.status(200).json(new ApiResponse(true, "Diagnostic center profile fetched", { center }));
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const data = updateCenterProfileSchema.parse(req.body);
  const center = await centerService.updateMyProfile(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Diagnostic center profile updated", { center }));
});

export const getMyStaffProfile = asyncHandler(async (req, res) => {
  const profile = await centerService.getStaffProfile(req.user.id);
  res.status(200).json(new ApiResponse(true, "Staff profile fetched", { profile }));
});

export const addStaff = asyncHandler(async (req, res) => {
  const data = createStaffSchema.parse(req.body);
  const result = await centerService.addStaff(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Staff account created successfully", result));
});

export const listStaff = asyncHandler(async (req, res) => {
  const staff = await centerService.listMyStaff(req.user.id);
  res.status(200).json(new ApiResponse(true, "Staff fetched", { staff }));
});

export const changeStaffPassword = asyncHandler(async (req, res) => {
  const data = changeStaffPasswordSchema.parse(req.body);
  await centerService.changeStaffPassword(req.user.id, data);
  res.status(200).json(new ApiResponse(true, "Password updated successfully"));
});

export const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image file provided");
  const center = await centerService.uploadLogo(req.user.id, req.file.buffer);
  res.status(200).json(new ApiResponse(true, "Logo uploaded", { center }));
});

export const searchByName = asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) throw new ApiError(400, "name query param is required");
  const centers = await centerService.searchByName(name);
  res.status(200).json(new ApiResponse(true, "Diagnostic centers fetched", { centers }));
});

export const listAllApprovedCenters = asyncHandler(async (req, res) => {
  const centers = await centerService.listAllApprovedCenters();
  res.status(200).json(new ApiResponse(true, "Diagnostic centers fetched", { centers }));
});

export const getGlobalTests = asyncHandler(async (req, res) => {
  const tests = await centerService.listActiveGlobalTests();
  res.status(200).json(new ApiResponse(true, "Global diagnostic tests fetched", { tests }));
});

export const getMyTests = asyncHandler(async (req, res) => {
  const tests = await centerService.listMyTests(req.user.id);
  res.status(200).json(new ApiResponse(true, "Center tests fetched", { tests }));
});

export const addCenterTest = asyncHandler(async (req, res) => {
  const data = addCenterTestSchema.parse(req.body);
  const test = await centerService.addCenterTest(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Test added to center successfully", { test }));
});

export const updateCenterTest = asyncHandler(async (req, res) => {
  const data = updateCenterTestSchema.parse(req.body);
  const test = await centerService.updateCenterTestConfig(req.user.id, req.params.testId, data);
  res.status(200).json(new ApiResponse(true, "Test configuration updated", { test }));
});

export const removeCenterTest = asyncHandler(async (req, res) => {
  await centerService.removeCenterTestConfig(req.user.id, req.params.testId);
  res.status(200).json(new ApiResponse(true, "Test removed from center"));
});
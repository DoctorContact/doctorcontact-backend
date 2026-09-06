import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as followupService from "./followup.service.js";
import { scheduleFollowupSchema, listClinicFollowupsQuerySchema } from "./followup.validation.js";

export const scheduleFollowup = asyncHandler(async (req, res) => {
  const data = scheduleFollowupSchema.parse(req.body);
  const followup = await followupService.scheduleFollowup(req.user, data);
  res.status(201).json(new ApiResponse(true, "Follow-up scheduled", { followup }));
});

export const getClinicFollowups = asyncHandler(async (req, res) => {
  const filters = listClinicFollowupsQuerySchema.parse(req.query);
  const followups = await followupService.getClinicFollowups(req.user, req.params.clinicId, filters);
  res.status(200).json(new ApiResponse(true, "Follow-ups fetched", { followups }));
});

export const getMyFollowups = asyncHandler(async (req, res) => {
  const followups = await followupService.getMyFollowups(req.user.id);
  res.status(200).json(new ApiResponse(true, "Your follow-ups", { followups }));
});

export const cancelFollowup = asyncHandler(async (req, res) => {
  const followup = await followupService.cancelFollowup(req.user, req.params.followupId);
  res.status(200).json(new ApiResponse(true, "Follow-up cancelled", { followup }));
});

export const completeFollowup = asyncHandler(async (req, res) => {
  const followup = await followupService.completeFollowup(req.user, req.params.followupId);
  res.status(200).json(new ApiResponse(true, "Follow-up marked completed", { followup }));
});

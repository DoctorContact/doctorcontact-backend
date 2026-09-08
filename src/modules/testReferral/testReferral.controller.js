import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as referralService from "./testReferral.service.js";
import {
  createReferralSchema,
  listQuerySchema,
  updateReferralStatusSchema,
} from "./testReferral.validation.js";

export const createReferral = asyncHandler(async (req, res) => {
  const data = createReferralSchema.parse(req.body);
  const referral = await referralService.createTestReferral(req.user, data);
  res.status(201).json(new ApiResponse(true, "Test referral created", { referral }));
});

export const getMyReferrals = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const referrals = await referralService.getMyReferralsAsPatient(req.user.id, query);
  res.status(200).json(new ApiResponse(true, "Referrals fetched", { referrals }));
});

export const getIncomingReferrals = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const referrals = await referralService.getIncomingReferrals(req.user, query);
  res.status(200).json(new ApiResponse(true, "Incoming referrals fetched", { referrals }));
});

export const getSentReferrals = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const referrals = await referralService.getSentReferrals(req.user.id, query);
  res.status(200).json(new ApiResponse(true, "Sent referrals fetched", { referrals }));
});

export const getAllReferrals = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const referrals = await referralService.getAllReferralsForAdmin(query);
  res.status(200).json(new ApiResponse(true, "All referrals fetched", { referrals }));
});

export const getCenterStats = asyncHandler(async (req, res) => {
  const stats = await referralService.getCenterReferralStats(req.user);
  res.status(200).json(new ApiResponse(true, "Center stats fetched", { stats }));
});

export const getReferralById = asyncHandler(async (req, res) => {
  const referral = await referralService.getReferralDetails(req.user, req.params.id);
  res.status(200).json(new ApiResponse(true, "Referral fetched", { referral }));
});

export const updateReferralStatus = asyncHandler(async (req, res) => {
  const data = updateReferralStatusSchema.parse(req.body);
  const referral = await referralService.updateReferralStatus(req.user, req.params.id, data);
  res.status(200).json(new ApiResponse(true, "Referral status updated", { referral }));
});
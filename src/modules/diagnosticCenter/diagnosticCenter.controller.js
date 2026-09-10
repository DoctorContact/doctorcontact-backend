import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import * as centerService from "./diagnosticCenter.service.js";
import { updateCenterProfileSchema, createStaffSchema, changeStaffPasswordSchema, addCenterTestSchema, updateCenterTestSchema } from "./diagnosticCenter.validation.js";
import { findCenterById, getCenterTests, getWorkingHours } from "./diagnosticCenter.repository.js";

export const getMyProfile = asyncHandler(async (req, res) => {
  const center = await centerService.getMyProfile(req.user.id);
  
  const workingHours = await getWorkingHours(center.id);
  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).toUpperCase();
  const currentTimeStr = now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    timeZone: 'Asia/Kolkata' 
  }); 

  let isCurrentlyOpen = false;
  const todaySchedule = workingHours.find(h => h.dayOfWeek === currentDay);
  if (todaySchedule && !todaySchedule.isClosed && todaySchedule.openTime && todaySchedule.closeTime) {
    if (currentTimeStr >= todaySchedule.openTime && currentTimeStr <= todaySchedule.closeTime) {
      isCurrentlyOpen = true; 
    }
  }

  center.isOnline = isCurrentlyOpen;
  center.hasHomeService = Boolean(center.hasHomeService);
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

// 🟢 listAllApprovedCenters: With proper Boolean check and Test mappings
export const listAllApprovedCenters = asyncHandler(async (req, res) => {
  const centers = await centerService.listAllApprovedCenters();
  
  const enrichedCenters = await Promise.all(
    centers.map(async (center) => {
      // 1. Fetch available tests (Max 5)
      const allTests = await getCenterTests(center.id);
      const availableTests = allTests.filter((t) => t.isAvailable);

      // 2. Fetch and calculate online status based on working hours
      const workingHours = await getWorkingHours(center.id);
      const now = new Date();
      const currentDay = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).toUpperCase();
      const currentTimeStr = now.toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' 
      }); 

      let isCurrentlyOpen = false;
      const todaySchedule = workingHours.find(h => h.dayOfWeek === currentDay);
      if (todaySchedule && !todaySchedule.isClosed && todaySchedule.openTime && todaySchedule.closeTime) {
        if (currentTimeStr >= todaySchedule.openTime && currentTimeStr <= todaySchedule.closeTime) {
          isCurrentlyOpen = true;
        }
      }

      return {
        ...center,
        hasHomeService: Boolean(center.hasHomeService), // 🟢 Force strict boolean
        isOnline: isCurrentlyOpen, 
        centerTests: availableTests 
      };
    })
  );

  res.status(200).json(new ApiResponse(true, "Diagnostic centers fetched", { centers: enrichedCenters }));
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

export const getPublicCenterDetails = asyncHandler(async (req, res) => {
  const center = await findCenterById(req.params.id);
  if (!center) throw new ApiError(404, "Diagnostic center not found");
  
  const allTests = await getCenterTests(center.id);
  const tests = allTests.filter(t => t.isAvailable);

  const workingHours = await getWorkingHours(center.id);
  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).toUpperCase();
  const currentTimeStr = now.toLocaleTimeString('en-US', { 
    hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' 
  }); 

  let isCurrentlyOpen = false;
  const todaySchedule = workingHours.find(h => h.dayOfWeek === currentDay);
  if (todaySchedule && !todaySchedule.isClosed && todaySchedule.openTime && todaySchedule.closeTime) {
    if (currentTimeStr >= todaySchedule.openTime && currentTimeStr <= todaySchedule.closeTime) {
      isCurrentlyOpen = true; 
    }
  }

  center.isOnline = isCurrentlyOpen;
  center.hasHomeService = Boolean(center.hasHomeService);
  res.status(200).json(new ApiResponse(true, "Center details fetched", { center, tests }));
});

// Admin Controllers
export const adminAddGlobalTest = asyncHandler(async (req, res) => {
  const test = await centerService.addGlobalTest(req.body);
  res.status(201).json(new ApiResponse(true, "Test created", { test }));
});
export const adminUpdateGlobalTest = asyncHandler(async (req, res) => {
  const test = await centerService.updateGlobalTest(req.params.id, req.body);
  res.status(200).json(new ApiResponse(true, "Test updated", { test }));
});
export const adminDeleteGlobalTest = asyncHandler(async (req, res) => {
  await centerService.removeGlobalTest(req.params.id);
  res.status(200).json(new ApiResponse(true, "Test deleted"));
});

// Lab Controllers
export const updateWorkingHours = asyncHandler(async (req, res) => {
  const hours = await centerService.updateCenterWorkingHours(req.user.id, req.body.hours);
  res.status(200).json(new ApiResponse(true, "Working hours updated", { hours }));
});
export const getCenterWorkingHoursController = asyncHandler(async (req, res) => {
  const hours = await centerService.getCenterWorkingHours(req.user.id);
  res.status(200).json(new ApiResponse(true, "Working hours fetched", { hours }));
});
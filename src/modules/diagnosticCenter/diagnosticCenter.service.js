import ApiError from "../../utils/apiError.js";
import { hashPassword } from "../auth/auth.helper.js";
import { findUserByEmail, updateUserPassword } from "../auth/auth.repository.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import {
  findCenterByUserId, findCenterById, updateCenterProfile, updateCenterLogo,
  createStaffWithUser, findStaffByCenter, findStaffByUserId, searchCentersByName,
  searchAllApprovedCenters, findApprovedCenterWithTests, getActiveGlobalTests,
  getCenterTests, findCenterTestById, addTestToCenter, updateCenterTest, removeCenterTest,
  findWorkingHoursByCenterId, upsertWorkingHours,
  createGlobalTest, updateGlobalTest, deleteGlobalTest
} from "./diagnosticCenter.repository.js";

export const getMyProfile = async (userId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return center;
};

export const getStaffProfile = async (userId) => {
  const staff = await findStaffByUserId(userId);
  if (!staff) throw new ApiError(404, "Staff profile not found");
  return staff;
};

export const updateMyProfile = async (userId, data) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return updateCenterProfile(center.id, data);
};

export const addStaff = async (centerUserId, payload) => {
  const center = await findCenterByUserId(centerUserId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  if (!center.isApproved) throw new ApiError(403, "Your center is not approved");

  const existing = await findUserByEmail(payload.email);
  if (existing) throw new ApiError(409, "User with this email already exists");

  const hashedPassword = await hashPassword(payload.password);
  const { user, staff } = await createStaffWithUser({
    userData: { ...payload, password: hashedPassword },
    diagnosticCenterId: center.id,
  });

  const { password, refreshToken, ...safeUser } = user;
  return { user: safeUser, staff };
};

export const listMyStaff = async (centerUserId) => {
  const center = await findCenterByUserId(centerUserId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return findStaffByCenter(center.id);
};

export const changeStaffPassword = async (centerUserId, { userId, newPassword }) => {
  const center = await findCenterByUserId(centerUserId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  const staff = await findStaffByUserId(userId);
  if (!staff || staff.diagnosticCenterId !== center.id) {
    throw new ApiError(404, "Staff member not found at your diagnostic center");
  }
  const hashedPassword = await hashPassword(newPassword);
  await updateUserPassword(userId, hashedPassword);
};

export const uploadLogo = async (centerUserId, fileBuffer) => {
  const center = await findCenterByUserId(centerUserId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  const result = await uploadBufferToCloudinary(fileBuffer, "jeet/diagnostic-centers");
  const updated = await updateCenterLogo(center.id, result.secure_url);
  if (center.logo) await deleteFromCloudinary(center.logo);
  return updated;
};

export const searchByName = async (name) => searchCentersByName(name);
export const listAllApprovedCenters = async () => searchAllApprovedCenters();
export const getPublicCenterDetails = async (centerId) => {
  const result = await findApprovedCenterWithTests(centerId);
  if (!result) throw new ApiError(404, "Diagnostic center not found");
  return result;
};

// =======================================
// 🔴 NEW: Admin Global Tests Logic
// =======================================
export const listActiveGlobalTests = async () => getActiveGlobalTests();
export const addGlobalTest = async (payload) => createGlobalTest(payload);
export const updateGlobalTestConfig = async (id, payload) => updateGlobalTest(id, payload);
export const removeGlobalTest = async (id) => deleteGlobalTest(id);

// =======================================
// 🔴 Center Own Tests Logic
// =======================================
export const listMyTests = async (userId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return getCenterTests(center.id);
};

export const addCenterTest = async (userId, payload) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  // 🟢 আগে থেকে টেস্ট আছে কিনা সেই চেকিং ডিলিট করা হয়েছে (একই টেস্ট মাল্টিপল প্রাইজ সাপোর্ট করার জন্য)
  return addTestToCenter({
    diagnosticCenterId: center.id,
    testId: payload.testId,
    price: payload.price,
    isAvailable: payload.isAvailable,
  });
};

export const updateCenterTestConfig = async (userId, centerTestId, payload) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  const centerTest = await findCenterTestById(centerTestId);
  if (!centerTest || centerTest.diagnosticCenterId !== center.id) {
    throw new ApiError(404, "Test configuration not found in your center");
  }
  return updateCenterTest(centerTestId, payload);
};

export const removeCenterTestConfig = async (userId, centerTestId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  const centerTest = await findCenterTestById(centerTestId);
  if (!centerTest || centerTest.diagnosticCenterId !== center.id) {
    throw new ApiError(404, "Test configuration not found in your center");
  }
  await removeCenterTest(centerTestId);
  return { deleted: true };
};

// === Working Hours ===
export const getMyWorkingHours = async (userId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return findWorkingHoursByCenterId(center.id);
};

export const updateMyWorkingHours = async (userId, hours) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return upsertWorkingHours(center.id, hours);
};
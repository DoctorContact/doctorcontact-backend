import ApiError from "../../utils/apiError.js";
import { hashPassword } from "../auth/auth.helper.js";
import { findUserByEmail, updateUserPassword } from "../auth/auth.repository.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../../utils/cloudinaryUpload.js";
import {
  findCenterByUserId,
  findCenterById,
  updateCenterProfile,
  updateCenterLogo,
  createStaffWithUser,
  findStaffByCenter,
  findStaffByUserId,
  findStaffById,
  searchCentersByName,
  searchAllApprovedCenters,
  getActiveGlobalTests,
  getCenterTests,
  findCenterTestById,
  findCenterTestByCenterAndTest,
  addTestToCenter,
  updateCenterTest,
  removeCenterTest,
  // 🟢 যুক্ত করা হলো
  findGlobalTestByName,
  createGlobalTest, 
  editGlobalTest, 
  deleteGlobalTest, 
  upsertWorkingHours, 
  getWorkingHours 
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
  if (!center.isApproved) throw new ApiError(403, "Your diagnostic center is not yet approved by admin");

  const existing = await findUserByEmail(payload.email);
  if (existing) throw new ApiError(409, "A user with this email already exists");

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

  if (center.logo) {
    await deleteFromCloudinary(center.logo);
  }

  return updated;
};

export const searchByName = async (name) => {
  return searchCentersByName(name);
};

export const listAllApprovedCenters = async () => {
  return searchAllApprovedCenters();
};

export const listActiveGlobalTests = async () => {
  return getActiveGlobalTests();
};

export const listMyTests = async (userId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");
  return getCenterTests(center.id);
};

export const addCenterTest = async (userId, payload) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Diagnostic center profile not found");

  const existingMapping = await findCenterTestByCenterAndTest(center.id, payload.testId);
  if (existingMapping) {
    throw new ApiError(409, "This test is already added to your center. Please update it instead.");
  }

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

export const addGlobalTest = async (data) => {
  // 🟢 Prisma সরাসরি ব্যবহার না করে Repository এর ফাংশন কল করা হলো
  const existing = await findGlobalTestByName(data.name);
  if (existing) {
    throw new ApiError(409, "A test with this name already exists.");
  }
  return createGlobalTest(data);
};

export const updateGlobalTest = async (id, data) => {
  if (data.name) {
    // 🟢 Prisma সরাসরি ব্যবহার না করে Repository এর ফাংশন কল করা হলো
    const existing = await findGlobalTestByName(data.name);
    if (existing && existing.id !== id) {
      throw new ApiError(409, "A test with this name already exists.");
    }
  }
  return editGlobalTest(id, data);
};

export const removeGlobalTest = async (id) => deleteGlobalTest(id);

export const updateCenterWorkingHours = async (userId, hoursData) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Center not found");
  return upsertWorkingHours(center.id, hoursData);
};

export const getCenterWorkingHours = async (userId) => {
  const center = await findCenterByUserId(userId);
  if (!center) throw new ApiError(404, "Center not found");
  return getWorkingHours(center.id);
};
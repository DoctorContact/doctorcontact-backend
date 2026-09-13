import prisma from "../../config/db.config.js";

export const findCenterByUserId = (userId) => {
  return prisma.diagnosticCenter.findUnique({ where: { userId } });
};

export const findCenterById = (id) => {
  return prisma.diagnosticCenter.findUnique({ where: { id } });
};

// Public lab-details page: only ever expose APPROVED centers. Pulls
// workingHours (for the Available Now / Offline badge) and availableTests
// (with price/availability) in one query so the frontend needs one call.
export const findApprovedCenterWithTests = (id) => {
  return prisma.diagnosticCenter.findFirst({
    where: { id, isApproved: true },
    include: {
      workingHours: true,
      availableTests: {
        where: { isAvailable: true },
        include: { test: true },
        orderBy: { test: { name: "asc" } },
      },
    },
  });
};

// --- Working hours (own dashboard, mirrors clinic.repository.js pattern) ---
export const upsertCenterWorkingHours = (diagnosticCenterId, workingHours) =>
  prisma.$transaction(
    workingHours.map((wh) =>
      prisma.diagnosticCenterWorkingHours.upsert({
        where: {
          diagnosticCenterId_dayOfWeek: { diagnosticCenterId, dayOfWeek: wh.dayOfWeek },
        },
        update: { openTime: wh.openTime, closeTime: wh.closeTime, isClosed: wh.isClosed },
        create: { diagnosticCenterId, ...wh },
      })
    )
  );

export const findCenterWorkingHours = (diagnosticCenterId) =>
  prisma.diagnosticCenterWorkingHours.findMany({
    where: { diagnosticCenterId },
    orderBy: { dayOfWeek: "asc" },
  });

export const updateCenterProfile = (id, data) => {
  return prisma.diagnosticCenter.update({ where: { id }, data });
};

export const updateCenterLogo = (id, logo) => {
  return prisma.diagnosticCenter.update({ where: { id }, data: { logo } });
};

export const createStaffWithUser = ({ userData, diagnosticCenterId }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...userData, role: "DIAGNOSTIC_STAFF", selfRegistered: false },
    });

    const staff = await tx.diagnosticCenterStaff.create({
      data: { userId: user.id, diagnosticCenterId },
    });

    return { user, staff };
  });
};

export const findStaffByCenter = (diagnosticCenterId) => {
  return prisma.diagnosticCenterStaff.findMany({
    where: { diagnosticCenterId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
    },
  });
};

export const findStaffByUserId = (userId) => {
  return prisma.diagnosticCenterStaff.findUnique({
    where: { userId },
    include: { diagnosticCenter: true },
  });
};

export const findStaffById = (id) => {
  return prisma.diagnosticCenterStaff.findUnique({ where: { id } });
};

// NOTE: hasHomeService + workingHours are included here (not just on the
// public single-center endpoint) because the labs LIST page filters by
// "home service only" and shows an ONLINE badge per card — without these
// two fields that filter/badge silently does nothing on every card.
const LIST_SELECT = {
  id: true,
  centerName: true,
  city: true,
  address: true,
  logo: true,
  hasHomeService: true,
  workingHours: true,
};

export const searchCentersByName = (name) => {
  return prisma.diagnosticCenter.findMany({
    where: {
      isApproved: true,
      centerName: { contains: name, mode: "insensitive" },
    },
    select: LIST_SELECT,
  });
};

export const searchAllApprovedCenters = () => {
  return prisma.diagnosticCenter.findMany({
    where: { isApproved: true },
    select: LIST_SELECT,
  });
};

export const getActiveGlobalTests = () => {
  return prisma.diagnosticTest.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
};

// Fetch tests specific to a center (with pricing and availability)
export const getCenterTests = (diagnosticCenterId) => {
  return prisma.centerTest.findMany({
    where: { diagnosticCenterId },
    include: { test: true },
    orderBy: { test: { name: "asc" } },
  });
};

export const findCenterTestById = (id) => {
  return prisma.centerTest.findUnique({ where: { id } });
};

export const findCenterTestByCenterAndTest = (diagnosticCenterId, testId) => {
  return prisma.centerTest.findUnique({
    where: { diagnosticCenterId_testId: { diagnosticCenterId, testId } },
  });
};

export const addTestToCenter = (data) => {
  return prisma.centerTest.create({
    data,
    include: { test: true },
  });
};

export const updateCenterTest = (id, data) => {
  return prisma.centerTest.update({
    where: { id },
    data,
    include: { test: true },
  });
};

export const removeCenterTest = (id) => {
  return prisma.centerTest.delete({
    where: { id },
  });
};
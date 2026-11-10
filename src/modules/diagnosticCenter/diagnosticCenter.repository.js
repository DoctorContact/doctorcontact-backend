import prisma from "../../config/db.config.js";
import { evaluateCenterAvailability } from "./diagnosticCenter.helper.js";

// =====================================
// 🔴 NEW: Global Tests Database Queries
// =====================================
export const createGlobalTest = (data) => prisma.diagnosticTest.create({ data });
export const updateGlobalTest = (id, data) => prisma.diagnosticTest.update({ where: { id }, data });
export const deleteGlobalTest = (id) => prisma.diagnosticTest.delete({ where: { id } });
export const getActiveGlobalTests = () => prisma.diagnosticTest.findMany({
  where: { isActive: true }, orderBy: { name: "asc" }
});

// =====================================
// Diagnostic Center Queries
// =====================================
export const findCenterByUserId = async (userId) => {
  const center = await prisma.diagnosticCenter.findUnique({
    where: { userId }, include: { workingHours: true },
  });
  if (!center) return null;
  const { workingHours, ...centerData } = center;
  const availability = evaluateCenterAvailability({ workingHours });
  return { ...centerData, isOnline: availability.isOnline, availabilityStatus: availability.status };
};

export const findCenterById = (id) => prisma.diagnosticCenter.findUnique({ where: { id } });
export const updateCenterProfile = (id, data) => prisma.diagnosticCenter.update({ where: { id }, data });
export const updateCenterLogo = (id, logo) => prisma.diagnosticCenter.update({ where: { id }, data: { logo } });

export const createStaffWithUser = ({ userData, diagnosticCenterId }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...userData, role: "DIAGNOSTIC_STAFF", selfRegistered: false } });
    const staff = await tx.diagnosticCenterStaff.create({ data: { userId: user.id, diagnosticCenterId } });
    return { user, staff };
  });
};

export const findStaffByCenter = (diagnosticCenterId) => prisma.diagnosticCenterStaff.findMany({
  where: { diagnosticCenterId },
  include: { user: { select: { id: true, name: true, email: true, phone: true, isActive: true } } },
});

export const findStaffByUserId = (userId) => prisma.diagnosticCenterStaff.findUnique({
  where: { userId }, include: { diagnosticCenter: true },
});

export const searchCentersByName = (name) => prisma.diagnosticCenter.findMany({
  where: { isApproved: true, centerName: { contains: name, mode: "insensitive" } },
  select: { id: true, centerName: true, city: true, address: true, logo: true },
});

const withDiagnosticTestAlias = (centerTest) => {
  if (!centerTest) return centerTest;
  const { test, ...rest } = centerTest;
  return { ...rest, diagnosticTest: test };
};

export const searchAllApprovedCenters = async () => {
  const centers = await prisma.diagnosticCenter.findMany({
    where: { isApproved: true },
    select: {
      id: true, centerName: true, city: true, address: true, logo: true, isApproved: true,
      phone: true, whatsapp: true, googleMapsUrl: true, hasHomeService: true, workingHours: true,
      availableTests: { where: { isAvailable: true }, include: { test: true }, orderBy: { test: { name: "asc" } } },
    },
  });
  return centers.map(({ availableTests, workingHours, ...center }) => ({
    ...center, centerTests: availableTests.map(withDiagnosticTestAlias),
    isOnline: evaluateCenterAvailability({ workingHours }).isOnline,
  }));
};

export const findApprovedCenterWithTests = async (id) => {
  const center = await prisma.diagnosticCenter.findFirst({
    where: { id, isApproved: true }, include: { workingHours: true },
  });
  if (!center) return null;
  const { workingHours, ...centerData } = center;
  const availability = evaluateCenterAvailability({ workingHours });
  const tests = await getCenterTests(id, { onlyAvailable: true });
  return { center: { ...centerData, isOnline: availability.isOnline, availabilityStatus: availability.status }, tests };
};

export const getCenterTests = async (diagnosticCenterId, { onlyAvailable = false } = {}) => {
  const rows = await prisma.centerTest.findMany({
    where: { diagnosticCenterId, ...(onlyAvailable ? { isAvailable: true } : {}) },
    include: { test: true }, orderBy: { test: { name: "asc" } },
  });
  return rows.map(withDiagnosticTestAlias);
};

export const findCenterTestById = (id) => prisma.centerTest.findUnique({ where: { id } });

export const addTestToCenter = async (data) => {
  const centerTest = await prisma.centerTest.create({ data, include: { test: true } });
  return withDiagnosticTestAlias(centerTest);
};

export const updateCenterTest = async (id, data) => {
  const centerTest = await prisma.centerTest.update({ where: { id }, data, include: { test: true } });
  return withDiagnosticTestAlias(centerTest);
};

export const removeCenterTest = (id) => prisma.centerTest.delete({ where: { id } });

// === Working Hours ===
export const findWorkingHoursByCenterId = (diagnosticCenterId) => prisma.diagnosticCenterWorkingHours.findMany({
  where: { diagnosticCenterId }, orderBy: { dayOfWeek: "asc" },
});

export const upsertWorkingHours = async (diagnosticCenterId, hours) => {
  return prisma.$transaction(
    hours.map((h) => prisma.diagnosticCenterWorkingHours.upsert({
      where: { diagnosticCenterId_dayOfWeek: { diagnosticCenterId, dayOfWeek: h.dayOfWeek } },
      update: { openTime: h.openTime ?? null, closeTime: h.closeTime ?? null, isClosed: h.isClosed ?? false },
      create: { diagnosticCenterId, dayOfWeek: h.dayOfWeek, openTime: h.openTime ?? null, closeTime: h.closeTime ?? null, isClosed: h.isClosed ?? false },
    }))
  );
};
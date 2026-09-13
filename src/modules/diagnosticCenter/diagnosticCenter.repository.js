import prisma from "../../config/db.config.js";
import { evaluateCenterAvailability } from "./diagnosticCenter.helper.js";

export const findCenterByUserId = async (userId) => {
  const center = await prisma.diagnosticCenter.findUnique({
    where: { userId },
    include: { workingHours: true },
  });
  if (!center) return null;

  const { workingHours, ...centerData } = center;
  const availability = evaluateCenterAvailability({ workingHours });
  return { ...centerData, isOnline: availability.isOnline, availabilityStatus: availability.status };
};

export const findCenterById = (id) => {
  return prisma.diagnosticCenter.findUnique({ where: { id } });
};

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

// Reshape a CenterTest row (Prisma relation is called `test`) into the shape
// the frontend expects (`diagnosticTest`), without touching the Prisma schema.
const withDiagnosticTestAlias = (centerTest) => {
  if (!centerTest) return centerTest;
  const { test, ...rest } = centerTest;
  return { ...rest, diagnosticTest: test };
};

export const searchCentersByName = (name) => {
  return prisma.diagnosticCenter.findMany({
    where: {
      isApproved: true,
      centerName: { contains: name, mode: "insensitive" },
    },
    select: { id: true, centerName: true, city: true, address: true, logo: true },
  });
};

export const searchAllApprovedCenters = async () => {
  const centers = await prisma.diagnosticCenter.findMany({
    where: { isApproved: true },
    select: {
      id: true,
      centerName: true,
      city: true,
      address: true,
      logo: true,
      isApproved: true,
      phone: true,
      whatsapp: true,
      googleMapsUrl: true,
      hasHomeService: true,
      workingHours: true,
      availableTests: {
        where: { isAvailable: true },
        include: { test: true },
        orderBy: { test: { name: "asc" } },
      },
    },
  });

  // Frontend expects each center to expose `centerTests` (with `diagnosticTest`
  // aliased from the Prisma `test` relation) and a boolean `isOnline`, which
  // is computed from today's DiagnosticCenterWorkingHours, not stored.
  return centers.map(({ availableTests, workingHours, ...center }) => ({
    ...center,
    centerTests: availableTests.map(withDiagnosticTestAlias),
    isOnline: evaluateCenterAvailability({ workingHours }).isOnline,
  }));
};

// Used by the public lab-details page: a single approved center + its tests.
export const findApprovedCenterWithTests = async (id) => {
  const center = await prisma.diagnosticCenter.findFirst({
    where: { id, isApproved: true },
    include: { workingHours: true },
  });

  if (!center) return null;

  const { workingHours, ...centerData } = center;
  const availability = evaluateCenterAvailability({ workingHours });

  const tests = await getCenterTests(id, { onlyAvailable: true });

  return {
    center: { ...centerData, isOnline: availability.isOnline, availabilityStatus: availability.status },
    tests,
  };
};

export const getActiveGlobalTests = () => {
  return prisma.diagnosticTest.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
};

// Fetch tests specific to a center (with pricing and availability)
export const getCenterTests = async (diagnosticCenterId, { onlyAvailable = false } = {}) => {
  const rows = await prisma.centerTest.findMany({
    where: {
      diagnosticCenterId,
      ...(onlyAvailable ? { isAvailable: true } : {}),
    },
    include: { test: true },
    orderBy: { test: { name: "asc" } },
  });

  // Alias the Prisma relation (`test`) to `diagnosticTest`, which is what
  // the frontend reads (e.g. `ct.diagnosticTest?.name`).
  return rows.map(withDiagnosticTestAlias);
};

export const findCenterTestById = (id) => {
  return prisma.centerTest.findUnique({ where: { id } });
};

export const findCenterTestByCenterAndTest = (diagnosticCenterId, testId) => {
  return prisma.centerTest.findUnique({
    where: { diagnosticCenterId_testId: { diagnosticCenterId, testId } },
  });
};

export const addTestToCenter = async (data) => {
  const centerTest = await prisma.centerTest.create({
    data,
    include: { test: true },
  });
  return withDiagnosticTestAlias(centerTest);
};

export const updateCenterTest = async (id, data) => {
  const centerTest = await prisma.centerTest.update({
    where: { id },
    data,
    include: { test: true },
  });
  return withDiagnosticTestAlias(centerTest);
};

export const removeCenterTest = (id) => {
  return prisma.centerTest.delete({
    where: { id },
  });
};

// === NEW: Working Hours ===
export const findWorkingHoursByCenterId = (diagnosticCenterId) => {
  return prisma.diagnosticCenterWorkingHours.findMany({
    where: { diagnosticCenterId },
    orderBy: { dayOfWeek: "asc" },
  });
};

export const upsertWorkingHours = async (diagnosticCenterId, hours) => {
  return prisma.$transaction(
    hours.map((h) =>
      prisma.diagnosticCenterWorkingHours.upsert({
        where: {
          diagnosticCenterId_dayOfWeek: { diagnosticCenterId, dayOfWeek: h.dayOfWeek },
        },
        update: {
          openTime: h.openTime ?? null,
          closeTime: h.closeTime ?? null,
          isClosed: h.isClosed ?? false,
        },
        create: {
          diagnosticCenterId,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime ?? null,
          closeTime: h.closeTime ?? null,
          isClosed: h.isClosed ?? false,
        },
      })
    )
  );
};
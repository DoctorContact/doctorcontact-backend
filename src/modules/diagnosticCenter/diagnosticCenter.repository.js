import prisma from "../../config/db.config.js";

export const findCenterByUserId = (userId) => {
  return prisma.diagnosticCenter.findUnique({ where: { userId } });
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

export const searchCentersByName = (name) => {
  return prisma.diagnosticCenter.findMany({
    where: {
      isApproved: true,
      centerName: { contains: name, mode: "insensitive" },
    },
    select: { id: true, centerName: true, city: true, address: true, logo: true },
  });
};

export const searchAllApprovedCenters = () => {
  return prisma.diagnosticCenter.findMany({
    where: { isApproved: true },
    select: { id: true, centerName: true, city: true, address: true, logo: true },
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
    include: { diagnosticTest: true },              // ছিল: test: true
    orderBy: { diagnosticTest: { name: "asc" } },    // ছিল: test: { name: "asc" }
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
    include: { diagnosticTest: true },               // ছিল: test: true
  });
};

export const updateCenterTest = (id, data) => {
  return prisma.centerTest.update({
    where: { id },
    data,
    include: { diagnosticTest: true },               // ছিল: test: true
  });
};

export const removeCenterTest = (id) => {
  return prisma.centerTest.delete({
    where: { id },
  });
};

// Part: working hours for a Diagnostic Center — mirrors
// clinic.repository.js's upsertWorkingHours/findWorkingHours exactly, just
// against DiagnosticCenterWorkingHours instead of ClinicWorkingHours.
export const upsertWorkingHours = (diagnosticCenterId, workingHours) =>
  prisma.$transaction(
    workingHours.map((wh) =>
      prisma.diagnosticCenterWorkingHours.upsert({
        where: { diagnosticCenterId_dayOfWeek: { diagnosticCenterId, dayOfWeek: wh.dayOfWeek } },
        update: { openTime: wh.openTime, closeTime: wh.closeTime, isClosed: wh.isClosed },
        create: { diagnosticCenterId, ...wh },
      })
    )
  );

export const findWorkingHours = (diagnosticCenterId) =>
  prisma.diagnosticCenterWorkingHours.findMany({
    where: { diagnosticCenterId },
    orderBy: { dayOfWeek: "asc" },
  });

export const findWorkingHoursForDay = (diagnosticCenterId, dayOfWeek) =>
  prisma.diagnosticCenterWorkingHours.findUnique({
    where: { diagnosticCenterId_dayOfWeek: { diagnosticCenterId, dayOfWeek } },
  });
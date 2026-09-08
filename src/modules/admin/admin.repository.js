import prisma from "../../config/db.config.js";

export const getPlatformSettings = () => {
  return prisma.platformSetting.findFirst();
};

export const updatePlatformSettings = (id, data) => {
  return prisma.platformSetting.update({ where: { id }, data });
};

export const findAllClinics = ({ isApproved, page = 1, limit = 20 }) => {
  const where = typeof isApproved === "boolean" ? { isApproved } : {};
  return prisma.clinic.findMany({
    where,
    include: { user: { select: { name: true, email: true, phone: true, isActive: true } } },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: "desc" },
  });
};

export const countClinics = (isApproved) => {
  const where = typeof isApproved === "boolean" ? { isApproved } : {};
  return prisma.clinic.count({ where });
};

export const findClinicByIdRaw = (id) => {
  return prisma.clinic.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
};

export const setClinicApproval = (id, isApproved) => {
  return prisma.clinic.update({ where: { id }, data: { isApproved } });
};

export const findAllDoctorsUnverified = () => {
  return prisma.doctor.findMany({
    where: { isVerified: false },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      clinic: { select: { clinicName: true } },
    },
  });
};

export const findDoctorByIdRaw = (id) => {
  return prisma.doctor.findUnique({ where: { id } });
};

export const setDoctorVerification = (id, isVerified) => {
  return prisma.doctor.update({ where: { id }, data: { isVerified } });
};

export const getPlatformStats = async () => {
  const [totalUsers, totalClinics, approvedClinics, totalDoctors, verifiedDoctors, totalPatients] =
    await Promise.all([
      prisma.user.count(),
      prisma.clinic.count(),
      prisma.clinic.count({ where: { isApproved: true } }),
      prisma.doctor.count(),
      prisma.doctor.count({ where: { isVerified: true } }),
      prisma.patient.count(),
    ]);

  return {
    totalUsers,
    totalClinics,
    approvedClinics,
    pendingClinics: totalClinics - approvedClinics,
    totalDoctors,
    verifiedDoctors,
    unverifiedDoctors: totalDoctors - verifiedDoctors,
    totalPatients,
  };
};

export const createAdminUser = (data) => {
  return prisma.user.create({
    data: { ...data, role: "ADMIN", selfRegistered: false, isVerified: true },
  });
};

// Admin-created doctor. clinicId is optional — a doctor may be onboarded before
// being attached to any clinic.
export const createDoctorUser = ({ userData, doctorData }) => {
  const { specializationIds, clinicId, ...rest } = doctorData || {};
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...userData, role: "DOCTOR", selfRegistered: false, isVerified: true },
    });

    const payload = { ...rest, userId: user.id, clinicId: clinicId ?? null };
    if (specializationIds && specializationIds.length > 0) {
      payload.specializations = {
        create: specializationIds.map((id) => ({ specializationId: id })),
      };
    }

    const doctor = await tx.doctor.create({ data: payload });
    return { user, doctor };
  });
};

// Global bookings feed for Super Admin — every clinic's patient appointments.
export const findAllAppointments = async ({ clinicId, status, from, to, page = 1, limit = 20 }) => {
  const where = {
    ...(clinicId && { clinicId }),
    ...(status && { status }),
    ...((from || to) && {
      date: { ...(from && { gte: from }), ...(to && { lte: to }) },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { name: true, phone: true, user: { select: { name: true, phone: true } } } },
        doctor: { select: { user: { select: { name: true } } } },
        clinic: { select: { clinicName: true, city: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);

  return { items, total, page, limit };
};

export const createClinicUser = ({ userData, clinicName }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...userData, role: "CLINIC", selfRegistered: false, isVerified: true },
    });

    const clinic = await tx.clinic.create({
      data: { userId: user.id, clinicName, isApproved: true },
    });

    return { user, clinic };
  });
};

export const createDiagnosticCenterUser = ({ userData, centerName }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...userData, role: "DIAGNOSTIC_CENTER", selfRegistered: false, isVerified: true },
    });

    const diagnosticCenter = await tx.diagnosticCenter.create({
      data: { userId: user.id, centerName, isApproved: true },
    });

    return { user, diagnosticCenter };
  });
};

export const updateDiagnosticCenterProfile = (id, data) => {
  return prisma.diagnosticCenter.update({
    where: { id },
    data,
  });
};

export const findAllDiagnosticCenters = ({ isApproved, page = 1, limit = 20 }) => {
  const where = typeof isApproved === "boolean" ? { isApproved } : {};
  return prisma.diagnosticCenter.findMany({
    where,
    include: { user: { select: { name: true, email: true, phone: true, isActive: true } } },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: "desc" },
  });
};

export const findDiagnosticCenterByIdRaw = (id) => {
  return prisma.diagnosticCenter.findUnique({ where: { id } });
};

export const setDiagnosticCenterApproval = (id, isApproved) => {
  return prisma.diagnosticCenter.update({ where: { id }, data: { isApproved } });
};

export const setDoctorFeatured = (doctorId, isFeatured, featuredOrder) => {
  return prisma.doctor.update({
    where: { id: doctorId },
    data: {
      isFeatured,
      featuredOrder: featuredOrder ?? (isFeatured ? 0 : 0),
    },
  });
};

export const findFeaturedDoctors = () => {
  return prisma.doctor.findMany({
    where: { isFeatured: true },
    include: {
      user: { select: { name: true } },
      clinic: { select: { clinicName: true, city: true } },
    },
    orderBy: { featuredOrder: "asc" },
  });
};

// === NEW: Step 24 Clinic Management ===

export const updateClinicByAdmin = async (id, { phone, ...clinicData }) => {
  return prisma.$transaction(async (tx) => {
    const clinic = await tx.clinic.update({
      where: { id },
      data: { ...clinicData, phone }
    });

    // Sync the phone number to the associated User account if provided
    if (phone) {
      await tx.user.update({
        where: { id: clinic.userId },
        data: { phone }
      });
    }

    return clinic;
  });
};

export const softDeleteClinic = async (id) => {
  return prisma.$transaction(async (tx) => {
    const clinic = await tx.clinic.findUnique({ where: { id } });
    if (!clinic) throw new Error("Clinic not found");

    // 1. Revoke approval and availability (removes from public directories)
    const updatedClinic = await tx.clinic.update({
      where: { id },
      data: { isApproved: false, isAvailableToday: false }
    });

    // 2. Deactivate the User account (prevents login without destroying history)
    await tx.user.update({
      where: { id: clinic.userId },
      data: { isActive: false }
    });

    return updatedClinic;
  });
};
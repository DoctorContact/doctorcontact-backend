import prisma from "../../config/db.config.js";

// Search covers BOTH: guest patients (phone stored directly on Patient)
// and self-registered patients (phone stored on their User)
export const findPatientByPhone = (phone) => {
  return prisma.patient.findFirst({
    where: {
      OR: [{ phone }, { user: { phone } }],
    },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });
};

export const findPatientByUserId = (userId) => {
  return prisma.patient.findUnique({
    where: { userId },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });
};

export const findPatientById = (id) => {
  return prisma.patient.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });
};

// Clinic/Receptionist "quick add" a patient (Name + Mobile). This now ALWAYS
// creates a full User account too (role PATIENT, no password) — not just a
// standalone Patient row — so that when this person later logs in with
// phone + OTP on their own, they land straight in the SAME account with all
// their appointment history already attached. No separate "linking" step.
//
// If a User already owns this phone (they self-registered earlier, or a
// different clinic already added them), we attach the new Patient-side
// context to that existing account instead of creating a duplicate — and if
// the name/gender typed in NOW differs from what's on file, the existing
// record gets updated in place (receptionist correcting a typo, patient's
// name changed, etc.) rather than silently keeping the old value.
export const createGuestPatient = async ({ name, phone, gender }) => {
  return prisma.$transaction(async (tx) => {
    // Patient.phone is unique system-wide (a patient's identity isn't
    // per-clinic), so if this phone is already a Patient anywhere, reuse it
    // instead of trying to insert a second row and hitting the unique
    // constraint. Appointments/queues stay clinic-scoped separately.
    const existing = phone
      ? await tx.patient.findUnique({
          where: { phone },
          include: { user: { select: { id: true, name: true, email: true, phone: true } } },
        })
      : null;

    if (existing) {
      const nameChanged = name && name !== existing.name;
      const genderChanged = gender && gender !== existing.gender;
      if (!nameChanged && !genderChanged) return existing;

      if (nameChanged && existing.userId) {
        await tx.user.update({ where: { id: existing.userId }, data: { name } });
      }

      return tx.patient.update({
        where: { id: existing.id },
        data: {
          name: nameChanged ? name : undefined,
          gender: genderChanged ? gender : undefined,
        },
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      });
    }

    let user = phone ? await tx.user.findUnique({ where: { phone } }) : null;

    if (!user) {
      user = await tx.user.create({
        data: {
          name,
          phone,
          role: "PATIENT",
          password: null,
          isVerified: false, // phone hasn't been OTP-verified by the patient themself yet
          selfRegistered: false,
        },
      });
    }

    return tx.patient.create({
      data: { userId: user.id, name, phone, gender },
      include: { user: { select: { id: true, name: true, email: true, phone: true } } },
    });
  });
};

export const updatePatientProfile = (userId, { name, dob, gender, bloodGroup }) => {
  return prisma.$transaction(async (tx) => {
    if (name) {
      await tx.user.update({ where: { id: userId }, data: { name } });
    }

    const patient = await tx.patient.update({
      where: { userId },
      data: { dob: dob ? new Date(dob) : undefined, gender, bloodGroup },
    });

    return patient;
  });
};

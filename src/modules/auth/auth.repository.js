import prisma from "../../config/db.config.js";

export const findUserByEmail = (email) => {
  return prisma.user.findUnique({ where: { email } });
};

export const findUserById = (id) => {
  return prisma.user.findUnique({ where: { id } });
};

export const findUserByPhone = (phone) => {
  return prisma.user.findUnique({ where: { phone } });
};

export const createUser = (data) => {
  return prisma.user.create({ data });
};

// Add or replace the `createUserWithProfile` function in auth.repository.js
export const createUserWithProfile = ({ userData, role, dob, guestPatientId }) => {
  return prisma.$transaction(async (tx) => {
    // 1. Create the App User
    const user = await tx.user.create({ data: userData });

    if (role === "PATIENT") {
      if (guestPatientId) {
        // STEP 9: Link existing Clinic-created Guest Patient to this new App User
        await tx.patient.update({
          where: { id: guestPatientId },
          data: {
            userId: user.id,
            dob: dob ? new Date(dob) : undefined,
          }
        });
      } else {
        // Create an entirely new Patient record
        await tx.patient.create({
          data: {
            userId: user.id,
            dob: dob ? new Date(dob) : undefined,
          }
        });
      }
    }
    
    // (If you have logic for creating other roles like Admin/Super Admin here, keep it)

    return user;
  });
};

// Used by phone/OTP login when NO account exists yet for this phone at all.
// No password, no email — phone is already verified by Firebase at this point.
export const createPhoneVerifiedPatient = ({ phone, name, guestPatientId }) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        phone,
        role: "PATIENT",
        password: null,
        isVerified: true,
        selfRegistered: !guestPatientId,
      },
    });

    if (guestPatientId) {
      // A clinic/receptionist already created this Patient (e.g. via a walk-in
      // that auto-creates an account) — attach the new User to it instead of
      // creating a duplicate Patient row.
      await tx.patient.update({
        where: { id: guestPatientId },
        data: { userId: user.id },
      });
    } else {
      await tx.patient.create({
        data: { userId: user.id, name, phone },
      });
    }

    return user;
  });
};

export const updateUserPassword = (id, password) => {
  return prisma.user.update({ where: { id }, data: { password } });
};

export const markUserVerified = (id) => {
  return prisma.user.update({ where: { id }, data: { isVerified: true } });
};

export const updateRefreshToken = (id, refreshToken) => {
  return prisma.user.update({ where: { id }, data: { refreshToken } });
};

export const clearRefreshToken = (id) => {
  return prisma.user.update({ where: { id }, data: { refreshToken: null } });
};
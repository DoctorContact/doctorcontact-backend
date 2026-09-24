import prisma from "../../config/db.config.js";

export const createAmbulance = (data) => prisma.ambulance.create({ data });

export const getAmbulances = (filter = {}) => prisma.ambulance.findMany({ where: filter, orderBy: { createdAt: "desc" } });

export const getAmbulanceById = (id) => prisma.ambulance.findUnique({ where: { id } });

export const updateAmbulance = (id, data) => prisma.ambulance.update({ where: { id }, data });

export const deleteAmbulance = (id) => prisma.ambulance.delete({ where: { id } });
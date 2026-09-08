import * as specializationRepo from "./specialization.repository.js";
import ApiError from "../../utils/apiError.js";

export const addSpecialization = async (data) => {
  const existing = await specializationRepo.findSpecializationByName(data.name);
  if (existing) throw new ApiError(409, "Specialization with this name already exists");
  
  return specializationRepo.createSpecialization(data);
};

export const editSpecialization = async (id, data) => {
  const existing = await specializationRepo.findSpecializationById(id);
  if (!existing) throw new ApiError(404, "Specialization not found");

  if (data.name && data.name !== existing.name) {
    const clash = await specializationRepo.findSpecializationByName(data.name);
    if (clash) throw new ApiError(409, "Another specialization already uses this name");
  }

  return specializationRepo.updateSpecialization(id, data);
};

export const fetchSpecializations = async (onlyActive = false) => {
  return specializationRepo.getAllSpecializations(onlyActive);
};
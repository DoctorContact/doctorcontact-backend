import ApiError from "../../utils/apiError.js";
import * as ambulanceRepo from "./ambulance.repository.js";

export const addAmbulance = async (data) => {
  const existing = await ambulanceRepo.getAmbulances({ vehicleNumber: data.vehicleNumber });
  if (existing.length > 0) throw new ApiError(409, "An ambulance with this vehicle number already exists.");
  return ambulanceRepo.createAmbulance(data);
};

export const getAllAmbulances = async (isAdmin = false) => {
  const filter = isAdmin ? {} : { isActive: true };
  return ambulanceRepo.getAmbulances(filter);
};

export const editAmbulance = async (id, data) => {
  const ambulance = await ambulanceRepo.getAmbulanceById(id);
  if (!ambulance) throw new ApiError(404, "Ambulance not found");
  
  if (data.vehicleNumber && data.vehicleNumber !== ambulance.vehicleNumber) {
    const existing = await ambulanceRepo.getAmbulances({ vehicleNumber: data.vehicleNumber });
    if (existing.length > 0) throw new ApiError(409, "This vehicle number is already registered.");
  }
  
  return ambulanceRepo.updateAmbulance(id, data);
};

export const removeAmbulance = async (id) => {
  const ambulance = await ambulanceRepo.getAmbulanceById(id);
  if (!ambulance) throw new ApiError(404, "Ambulance not found");
  return ambulanceRepo.deleteAmbulance(id);
};
import { Router } from "express";
import * as ambulanceController from "./ambulance.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";

const router = Router();

// Public Route: Anyone (Clinics/Patients) can view ACTIVE ambulances only
router.get("/", ambulanceController.getAmbulances);

// Admin Protected Routes: Only Super Admin/Admin can manage ambulances
router.use(authMiddleware, roleMiddleware("SUPER_ADMIN", "ADMIN"));

// 🟢 NEW: Admin specific route to get ALL ambulances (Active + Inactive)
router.get("/admin/all", ambulanceController.getAmbulances);

router.post("/", ambulanceController.addAmbulance);
router.patch("/:id", ambulanceController.updateAmbulance);
router.delete("/:id", ambulanceController.deleteAmbulance);

export default router;
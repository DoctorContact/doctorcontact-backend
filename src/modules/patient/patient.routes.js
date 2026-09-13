import { Router } from "express";
import * as patientController from "./patient.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import {searchByPhone} from "./patient.controller.js";

const router = Router();

/**
 * @swagger
 * /patient/search:
 *   get:
 *     summary: (Receptionist/Clinic) Search for a patient by phone number
 *     tags: [Patient]
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Patient found, or patient null if none matched }
 */
router.get(
  "/search",
  authMiddleware,
  roleMiddleware("RECEPTIONIST", "CLINIC"),
  patientController.searchPatient
);

/**
 * @swagger
 * /patient/guest:
 *   post:
 *     summary: (Receptionist/Clinic) Create a walk-in guest patient — no login account is created
 *     tags: [Patient]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, age]
 *             properties:
 *               name: { type: string }
 *               age: { type: integer }
 *               phone: { type: string }
 *               gender: { type: string, enum: [MALE, FEMALE, OTHER] }
 *     responses:
 *       201: { description: Guest patient created successfully }
 *       409: { description: A patient with this phone number already exists }
 */
router.post(
  "/guest",
  authMiddleware,
  roleMiddleware("RECEPTIONIST", "CLINIC"),
  patientController.createGuestPatient
);

/**
 * @swagger
 * /patient/me:
 *   get:
 *     summary: (Patient) Get my own patient profile
 *     tags: [Patient]
 *     responses:
 *       200: { description: Patient profile fetched }
 */
router.get("/me", authMiddleware, roleMiddleware("PATIENT"), patientController.getMyProfile);

/**
 * @swagger
 * /patient/me:
 *   patch:
 *     summary: (Patient) Update my own profile
 *     tags: [Patient]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               dob: { type: string, format: date-time }
 *               gender: { type: string, enum: [MALE, FEMALE, OTHER] }
 *               bloodGroup: { type: string, example: "O+" }
 *               address: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200: { description: Profile updated successfully }
 */
router.patch("/me", authMiddleware, roleMiddleware("PATIENT"), patientController.updateMyProfile);

// Legacy alias kept for backward compatibility with older frontend builds —
// now just delegates to the same authenticated, normalized lookup as
// /search (see patient.controller.searchByPhone). Do not use this in new
// code; call /patient/search instead.
router.get(
  "/search-by-phone",
  authMiddleware,
  roleMiddleware("RECEPTIONIST", "CLINIC"),
  patientController.searchByPhone
);

export default router;
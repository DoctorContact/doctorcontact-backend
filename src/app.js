import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";

import { env } from "./config/env.config.js";
import notFoundMiddleware from "./middlewares/notFound.middleware.js";
import errorMiddleware from "./middlewares/error.middleware.js";

import { generalLimiter } from "./middlewares/rateLimiter.middleware.js";

import authRoutes from "./modules/auth/auth.routes.js";
import clinicRoutes from "./modules/clinic/clinic.routes.js";
import receptionistRoutes from "./modules/receptionist/receptionist.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import patientRoutes from "./modules/patient/patient.routes.js";
import userRoutes from "./modules/user/user.routes.js";

import appointmentRoutes from "./modules/appointment/appointment.routes.js";
import queueRoutes from "./modules/queue/queue.routes.js";

import announcementRoutes from "./modules/announcement/announcement.routes.js";
import doctorRoutes from "./modules/doctor/doctor.routes.js";

import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";

import passport from "./config/passport.config.js"; // google auth
import reportRoutes from "./modules/report/report.routes.js"; // pdf 

import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.config.js";

import reviewRoutes from "./modules/review/review.routes.js"; 
import notificationRoutes from "./modules/notification/notification.routes.js";

import diagnosticCenterRoutes from "./modules/diagnosticCenter/diagnosticCenter.routes.js";
import testReferralRoutes from "./modules/testReferral/testReferral.routes.js";

import analyticsRoutes from "./modules/analytics/analytics.routes.js";

import locationRoutes from './modules/location/location.routes.js';

import specializationRoutes from "./modules/specialization/specialization.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import followupRoutes from "./modules/followup/followup.routes.js";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());
app.use(passport.initialize());  // this make for google with passport
app.use(generalLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    data: { environment: env.NODE_ENV },
  });
});

app.use("/api/v1/auth", authRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use("/api/v1/clinic", clinicRoutes);
app.use("/api/v1/receptionist", receptionistRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/patient", patientRoutes);
app.use("/api/v1/users", userRoutes);

app.use("/api/v1/appointments", appointmentRoutes);

app.use("/api/v1/queue", queueRoutes);

app.use("/api/v1/announcements", announcementRoutes);

app.use("/api/v1/doctors", doctorRoutes);

app.use("/api/v1/dashboard", dashboardRoutes);

app.use("/api/v1/reports", reportRoutes);

app.use("/api/v1/reviews", reviewRoutes);

app.use("/api/v1/notifications", notificationRoutes);

app.use("/api/v1/diagnostic-centers", diagnosticCenterRoutes);

app.use("/api/v1/test-referrals", testReferralRoutes);

app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/followups", followupRoutes);

app.use('/api/v1/specializations', specializationRoutes);

if (env.NODE_ENV == "development") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  
}

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
# MedConnect Backend API 🩺

A robust, full-stack **clinic appointment and doctor management system** backend, built to handle real-time patient queues, multi-role access control, and seamless clinic operations.

![Node.js](https://img.shields.io/badge/Node.js-Express-green)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-blue)
![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748)
![Socket.io](https://img.shields.io/badge/Realtime-Socket.io-black)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

---

## 📖 Table of Contents

- [About](#-about)
- [Tech Stack & Architecture](#-tech-stack--architecture)
- [Project Status](#-current-project-status)
- [Project Structure](#-project-structure)
- [Getting Started](#-local-development-setup)
- [Environment Variables](#-environment-variables)
- [Available Scripts](#-available-scripts)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 📌 About

**MedConnect** is a secure and scalable backend API designed to digitize day-to-day clinic operations — from doctor and receptionist management to live patient queues and appointment booking — with real-time updates and role-based access control at its core.

---

## 🛠 Tech Stack & Architecture

### Core Stack
- **Backend Framework:** Node.js, Express.js (v5)
- **Database & ORM:** PostgreSQL, Prisma ORM
- **Real-time Communication:** Socket.io
- **Caching:** Redis (via ioredis)

### Security & Authentication
- **Authentication:** JWT, Refresh Tokens, HTTP-Only Cookies, Google OAuth (via Passport)
- **Validation:** Zod
- **Security Middleware:** Helmet, CORS, Rate Limiter, Data Sanitization
- **Utilities:** Cookie Parser, Compression, bcrypt

### Integrations & Services
- **File Uploads:** Multer, Cloudinary
- **Email Services:** Nodemailer
- **PDF Generation:** PDFKit
- **Task Scheduling:** node-cron

### DevOps, Testing & Docs
- **Testing:** Jest, Supertest
- **Containerization:** Docker, Docker Compose
- **API Documentation:** Swagger (OpenAPI) — via swagger-jsdoc & swagger-ui-express
- **Logging:** Pino / pino-pretty

---

## 🚀 Current Project Status

### ✅ Fully Built and Tested Features
- **Authentication:** Complete flow with registration, login, JWT/refresh tokens, logout, and forgot-password OTP (via email).
- **Role-Based Access Control (RBAC):** Comprehensive support for all 6 core roles.
- **Clinic Operations:** Clinic, Doctor, and Receptionist management, including receptionist ↔ doctor assignment.
- **Admin Controls:** Clinic approval, doctor verification, user management, and global platform settings.
- **Patient Management:** Support for both guest patients (walk-ins) and self-registered patients.
- **Appointment & Queue System:**
  - Online and in-person reception booking.
  - Shared sequential token queue.
  - Advanced queue controls: Next, Previous, Skip, Recall, Pause, Resume, Close, Reopen, and Emergency modes (all backed by audit logs).
- **Booking Rules:** Configurable booking-window rules managed by the Super Admin.
- **Live Announcements:** Platform-wide, clinic-specific, and doctor-tied announcements broadcast live via Socket.io.

### 🟡 Work in Progress / Needs Implementation
- **Google OAuth:** Documented as a login method, but only email/password is currently implemented.
- **Multi-Clinic Doctors:** Schema currently ties one Doctor record to exactly one Clinic (1-to-1); needs restructuring to allow doctors to work across multiple clinics with a shared profile.
- **Queue Modes:** `queueMode` field exists (`LIVE` / `PRIVATE` / `TIME_SLOT`), but all queues currently default to "Live Queue" behavior. Private and Time Slot modes are pending.
- **Clinic Operational Settings:** Toggles for working hours, holiday configuration, and enabling/disabling online consultations are not yet built.
- **Reporting Module:** Daily/monthly clinic reports and PDF exports are pending.
- **Rate Limiting:** `rateLimiter.middleware.js` is wired up, but not yet applied to routes.
- **API Documentation:** Swagger integration has not started.
- **Deployment:** Dockerization and deployment pipelines (Phase 7) are pending.

### ❌ Explicitly Skipped Features
- Prescription Module
- Pharmacy Module

### 🔵 Future Scope (Low Priority)
- OTP delivery via SMS and WhatsApp.
- Expansion modules: Telemedicine, Payments, Insurance processing, Laboratory integration.
- Advanced features: AI integrations, multi-branch support, multi-language localization.

---

## 📂 Project Structure

```
doctor-management-system-backend/
├── prisma/          # Prisma schema & database migrations
├── src/             # Application source code (routes, controllers, middleware, services)
├── .gitignore
├── package.json
├── package-lock.json
└── readme.md
```

> Note: `src` contains the Express app entry (`src/server.js`) along with route, controller, middleware, and service layers for auth, clinics, doctors, receptionists, patients, queues, and announcements.

---

## 💻 Local Development Setup

### Prerequisites
- Node.js (LTS recommended)
- PostgreSQL database
- Redis instance
- Cloudinary account (for file uploads)
- SMTP credentials (for email/OTP via Nodemailer)

### Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/soumya28022005/doctor-management-system-backend.git
   cd doctor-management-system-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory (see [Environment Variables](#-environment-variables) below).

4. **Set up the database**
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **(Optional) Explore your database visually**
   ```bash
   npm run prisma:studio
   ```

---

## 🔐 Environment Variables

The project uses `dotenv`, so you'll need a `.env` file with variables such as:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/medconnect

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email (Nodemailer)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

> ⚠️ These are inferred from the project's dependencies (Prisma/Postgres, Redis, JWT, Passport-Google-OAuth20, Cloudinary, Nodemailer). Adjust names/values to match the actual code in `src/`.

---

## 📜 Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Starts the server in development mode with `nodemon` |
| `npm start` | Starts the server in production mode |
| `npm run prisma:generate` | Generates the Prisma client |
| `npm run prisma:migrate` | Runs Prisma migrations in dev mode |
| `npm run prisma:studio` | Opens Prisma Studio for visual DB management |

---

## 🗺 Roadmap

- [ ] Finish Google OAuth login flow
- [ ] Support multi-clinic doctor profiles
- [ ] Implement Private & Time Slot queue modes
- [ ] Build clinic operational settings (hours, holidays, online toggle)
- [ ] Build reporting module with PDF export
- [ ] Apply rate limiting across routes
- [ ] Add Swagger API documentation
- [ ] Dockerize and set up deployment pipeline

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome. Feel free to check the [issues page](https://github.com/soumya28022005/doctor-management-system-backend/issues).

---

## 📄 License

This project is licensed under the **ISC License**.


// just reminder that you have to check up ar kichu na- auto jabe, 
// doctor er kono joid induvial hok meni clini clinic nao tahke add kora jabe.-> aprove korta partivcular clinic 
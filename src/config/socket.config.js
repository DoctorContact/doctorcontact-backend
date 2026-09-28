import { Server } from "socket.io";
import logger from "./logger.config.js";

let io;

export const initSocket = (httpServer, corsOrigin) => {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    // 🌟 info থেকে debug করা হলো প্রোডাকশন নয়েজ কমানোর জন্য
    logger.debug(`🔌 Socket connected: ${socket.id}`);

    // Client joins a room specific to a doctor's queue to receive live updates
    socket.on("joinQueue", ({ doctorId, clinicId }) => {
      socket.join(`queue:${doctorId}:${clinicId}`);
      logger.debug(`Socket ${socket.id} joined queue:${doctorId}:${clinicId}`);
    });

    socket.on("leaveQueue", ({ doctorId, clinicId }) => {
      socket.leave(`queue:${doctorId}:${clinicId}`);
    });

    socket.on("joinAppointment", (appointmentId) => {
      socket.join(`appointment:${appointmentId}`);
      logger.debug(`Socket ${socket.id} joined appointment:${appointmentId}`);
    });

    socket.on("leaveAppointment", (appointmentId) => {
      socket.leave(`appointment:${appointmentId}`);
    });

    // Personal notification channel
    socket.on("joinUser", (userId) => {
      socket.join(`user:${userId}`);
      logger.debug(`Socket ${socket.id} joined user:${userId}`);
    });

    socket.on("leaveUser", (userId) => {
      socket.leave(`user:${userId}`);
    });

    socket.on("disconnect", () => {
      logger.debug(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
};
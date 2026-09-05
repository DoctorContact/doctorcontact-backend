import prisma from "../../config/db.config.js";

// General administrative audit trail (Step 53) — separate from QueueLog,
// which only covers queue-control actions (Next/Skip/Recall/etc).
//
// Fire-and-forget by design: logging must never break the action it's
// describing, so failures here are swallowed (and logged to console)
// rather than thrown.
export const logAudit = async ({ actorUserId, actorRole, action, targetType, targetId, meta }) => {
  try {
    await prisma.auditLog.create({
      data: { actorUserId, actorRole, action, targetType, targetId, meta },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", action, err.message);
  }
};

export const listAuditLogs = async ({ targetType, targetId, actorUserId, limit = 50 } = {}) => {
  return prisma.auditLog.findMany({
    where: {
      ...(targetType && { targetType }),
      ...(targetId && { targetId }),
      ...(actorUserId && { actorUserId }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
};

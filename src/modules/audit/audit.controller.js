import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import { listAuditLogs } from "./audit.service.js";

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { targetType, targetId, actorUserId, limit } = req.query;
  const logs = await listAuditLogs({
    targetType,
    targetId,
    actorUserId,
    limit: limit ? Number(limit) : undefined,
  });
  res.status(200).json(new ApiResponse(true, "Audit logs fetched", { logs }));
});

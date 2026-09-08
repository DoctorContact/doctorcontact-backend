import ApiError from "../utils/apiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/tokenGenerator.js";
import { findUserById } from "../modules/auth/auth.repository.js";

const authMiddleware = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Access token is missing");
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw new ApiError(401, "Invalid or expired access token");
  }

  const user = await findUserById(decoded.id);
  if (!user || !user.isActive) {
    throw new ApiError(401, "User no longer exists or is deactivated");
  }

  const { password, refreshToken, ...safeUser } = user;
  req.user = safeUser;
  next();
});

// Like authMiddleware, but never rejects: attaches req.user when a valid token
// is present and otherwise continues anonymously. For endpoints that are public
// but expose extra data to logged-in staff.
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  try {
    const decoded = verifyAccessToken(authHeader.split(" ")[1]);
    const user = await findUserById(decoded.id);
    if (user && user.isActive) {
      const { password, refreshToken, ...safeUser } = user;
      req.user = safeUser;
    }
  } catch {
    // ignore — treat as anonymous
  }
  next();
});

export default authMiddleware;
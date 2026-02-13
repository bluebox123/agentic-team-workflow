import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    orgId?: string;
  };
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id?: string;
      userId?: string;
      sub?: string;
      email: string;
      orgId?: string;
    };

    // Support flexible identity claims: id, userId, or sub
    const userId = payload.id || payload.userId || payload.sub;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token: missing user identifier" });
    }

    req.user = {
      id: userId,
      email: payload.email,
      // Pass through orgId if provided in token (useful for simplified org-scoped queries)
      orgId: payload.orgId
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Export alias for consistency
export const authMiddleware = requireAuth;

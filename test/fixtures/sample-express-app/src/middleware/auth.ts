import { Request, Response, NextFunction } from 'express';

import { User } from '../types';

export interface AuthRequest extends Request {
  user?: User;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded as User;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

function verifyToken(token: string): unknown {
  // Simplified for fixture purposes
  return JSON.parse(Buffer.from(token, 'base64').toString());
}

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

// Fail fast — refuse to start with a missing or weak secret
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be set and at least 32 characters long. ' +
    "Generate one: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}

export interface TokenPayload {
  id: string;
  email: string;
  role: string;
  fullName?: string;
  branchId?: string;
}

export const generateToken = (payload: TokenPayload): string => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as any;

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    algorithm: 'HS256',       // Explicit algorithm prevents 'none' confusion attacks
    issuer: 'biztrack-api',   // Issuer claim — verified on every decode
  });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],    // Whitelist only — reject RS256, none, etc.
    issuer: 'biztrack-api',
  }) as TokenPayload;
};

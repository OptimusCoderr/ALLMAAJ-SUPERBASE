import { Response } from 'express';

interface ApiResponseData {
  success: boolean;
  message: string;
  data?: any;
  error?: any;
  statusCode: number;
}

export const sendResponse = (
  res: Response,
  statusCode: number,
  message: string,
  data?: any
): Response => {
  return res.status(statusCode).json({
    success: statusCode < 400,
    message,
    data,
    statusCode,
  });
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  error?: any
): Response => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? error : undefined,
    statusCode,
  });
};

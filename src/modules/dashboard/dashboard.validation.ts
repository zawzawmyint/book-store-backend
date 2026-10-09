import { z } from 'zod'
export const dashboardPeriodSchema = z.enum(['DAYS_7', 'DAYS_30', 'DAYS_90'])

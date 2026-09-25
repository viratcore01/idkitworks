import api from './api';

export interface CollegeEmailStatus {
  collegeId: string | null;
  collegeName: string | null;
  /** Official student-mail domain for the user's college (e.g. "ipec.org.in"). */
  collegeEmailDomain: string | null;
  collegeEmail: string | null;
  collegeEmailVerified: boolean;
  collegeEmailVerifiedAt: string | null;
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  isVerified: boolean;
}

/**
 * College-email OTP verification.
 * The college email is locked permanently once verified — everything else
 * on the profile stays editable.
 */
export const verificationApi = {
  /** `reused: true` = a live code for this exact address was kept instead of
   *  mailing a new one (see EmailVerificationService.sendOtp), so the UI can say
   *  "your earlier code is still valid" instead of promising a fresh email. */
  sendCollegeEmail: (collegeEmail: string) =>
    api.post<{ sent: boolean; expiresIn: number; reused?: boolean }>('/verification/college-email/send', { collegeEmail }),
  verifyCollegeEmail: (code: string) =>
    api.post<{ verified: boolean; collegeEmail: string }>('/verification/college-email/verify', { code }),
  status: () => api.get<CollegeEmailStatus>('/verification/college-email/status'),
  resend: () => api.post<{ sent: boolean; expiresIn: number; reused?: boolean }>('/verification/college-email/resend'),
};

import api from './api';

export interface VerificationStatus {
  status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  isVerified: boolean;
  pending: { id: string; submittedAt: string; note?: string | null } | null;
  lastRejection: string | null;
}

export const verificationApi = {
  submit: (file: File) => {
    const form = new FormData();
    form.append('id', file);
    return api.post('/verification/id', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  status: () => api.get<VerificationStatus>('/verification/status'),
  queue: (page = 0) => api.get(`/verification/queue?page=${page}`),
  reviewImage: (id: string) => api.get(`/verification/${id}/image`, { responseType: 'blob' }),
  decide: (id: string, approve: boolean) => api.patch(`/verification/${id}/decide`, { approve }),
};

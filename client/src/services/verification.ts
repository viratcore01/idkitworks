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
    // NOTE: do NOT set 'Content-Type' manually here. axios/browser must add
    // the multipart boundary themselves; a hand-written multipart header
    // without the boundary makes the server see an empty body →
    // "No photo provided" even though the photo is attached.
    return api.post('/verification/id', form);
  },
  status: () => api.get<VerificationStatus>('/verification/status'),
  queue: (page = 0) => api.get(`/verification/queue?page=${page}`),
  reviewImage: (id: string) => api.get(`/verification/${id}/image`, { responseType: 'blob' }),
  decide: (id: string, approve: boolean) => api.patch(`/verification/${id}/decide`, { approve }),
};

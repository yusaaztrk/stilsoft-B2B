import { BadgeType } from '../../components/ui/Badge';

export const getStatusLabel = (status: string | undefined | null, originalLabel?: string | null): string => {
  if (!status) return originalLabel || '';
  const key = status.trim().toLowerCase();
  switch (key) {
    case 'new': return 'Yeni';
    case 'planned': return 'Planlandı';
    case 'workshop': return 'Atölyede';
    case 'inrepair': return 'Arıza Tamirinde';
    case 'waitingforparts': return 'Parça Bekliyor';
    case 'ready': return 'Hazır';
    case 'delivered': return 'Teslim Edildi';
    case 'completed': return 'Gerçekleşti';
    case 'cancelled': return 'İptal';
    case 'deferred': return 'Ertelendi';
    case 'inprogress': return 'Devam Ediyor';
    case 'pending': return 'Bekliyor';
    case 'delayed': return 'Gecikti';
    default: return originalLabel || status;
  }
};

export const getStatusBadgeType = (status: string | undefined | null): BadgeType => {
  if (!status) return 'neutral';
  const key = status.trim().toLowerCase();
  switch (key) {
    case 'completed':
    case 'ready':
    case 'delivered':
      return 'success';
    case 'inprogress':
    case 'workshop':
    case 'inrepair':
      return 'warning';
    case 'waitingforparts':
    case 'delayed':
      return 'error';
    case 'planned':
    case 'new':
      return 'info';
    default:
      return 'neutral';
  }
};

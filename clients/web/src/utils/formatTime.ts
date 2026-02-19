import { format, isToday, isYesterday } from 'date-fns';

export function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);

  if (isToday(date)) {
    return format(date, 'h:mm a');
  }

  if (isYesterday(date)) {
    return `Yesterday ${format(date, 'h:mm a')}`;
  }

  return format(date, 'MM/dd/yyyy h:mm a');
}
